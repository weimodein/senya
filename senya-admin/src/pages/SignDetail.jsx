import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, CircleAlert, Film, Hand, Move, Trash2, Upload } from "lucide-react";
import { signs as signsApi, targetFor } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Empty, Glyph, Readiness, Spinner, formatWhen } from "../components/ui.jsx";

const resultText = (kind, up) =>
  kind === "static"
    ? `${up.samples_added} sample${up.samples_added === 1 ? "" : "s"}`
    : `${up.segments_found} movement${up.segments_found === 1 ? "" : "s"}`;

/** One row of the upload queue: waiting → uploading → extracting → done | failed. */
function QueueRow({ item, kind }) {
  const { file, state, progress, result, error } = item;
  return (
    <li className="flex items-center gap-3 px-4 py-2.5">
      <Film className="size-4 shrink-0 text-ink-4" />
      <span className="min-w-0 flex-1 truncate text-body text-ink-2">{file.name}</span>
      <span className="num shrink-0 text-meta text-ink-4">{(file.size / 1e6).toFixed(1)} MB</span>
      <span className="flex w-52 shrink-0 items-center justify-end gap-1.5 text-meta">
        {state === "waiting" && <span className="text-ink-4">Waiting</span>}
        {state === "uploading" && (
          <>
            <Spinner className="size-3.5" />
            <span className="num text-ink-3">Uploading {Math.round(progress * 100)}%</span>
          </>
        )}
        {state === "extracting" && (
          <>
            <Spinner className="size-3.5 text-ochre" />
            <span className="text-ochre">Finding the hand…</span>
          </>
        )}
        {state === "done" && (
          <>
            <Check className="size-3.5 text-leaf" />
            <span className="font-medium text-leaf">{resultText(kind, result)}</span>
          </>
        )}
        {state === "failed" && (
          <>
            <CircleAlert className="size-3.5 shrink-0 text-rust" />
            <span className="truncate text-rust" title={error}>
              {error}
            </span>
          </>
        )}
      </span>
    </li>
  );
}

function DropZone({ sign, onFiles, busy }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const accept = sign.kind === "motion" ? "video/*" : "video/*,image/*";
  const pick = (files) => {
    const list = [...files].filter((f) => f.type.startsWith("video/") || (sign.kind === "static" && f.type.startsWith("image/")));
    if (list.length) onFiles(list);
  };
  return (
    <button
      type="button"
      onClick={() => input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        pick(e.dataTransfer.files);
      }}
      className={`flex w-full flex-col items-center gap-2 rounded-lg border-2 border-dashed px-6 py-9 text-center transition-colors duration-150 ${
        over ? "border-clay bg-clay-wash" : "border-rule-strong bg-card hover:border-clay/50"
      }`}
    >
      <Upload className={`size-5 ${over ? "text-clay" : "text-ink-3"}`} />
      <span className="text-h3 font-medium text-ink">
        {busy ? "Add more clips to the queue" : `Drop clips of ${sign.label === "_none" ? "random movement" : sign.label}`}
      </span>
      <span className="text-meta text-ink-3">
        {sign.kind === "static"
          ? "Short videos or photos of the handshape held still. Each clip gives up to 60 samples."
          : "Videos with the movement repeated a few times, pausing in between. Each repeat becomes one sample."}
      </span>
      <input ref={input} type="file" accept={accept} multiple hidden onChange={(e) => (pick(e.target.files), (e.target.value = ""))} />
    </button>
  );
}

function StartShapes({ sign, onSaved }) {
  const toast = useToast();
  const [value, setValue] = useState((sign.start_shapes || []).join(" "));
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const start_shapes = value.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      await signsApi.update(sign.id, { start_shapes });
      toast("Start shapes saved");
      onSaved();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="flex items-end gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-meta font-medium text-ink-2">Starts from the handshape of</span>
        <input className="field w-40 uppercase" value={value} onChange={(e) => setValue(e.target.value)} placeholder="I" />
      </label>
      <Button type="submit" loading={busy}>
        Save
      </Button>
    </form>
  );
}

export default function SignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [sign, setSign] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [samples, setSamples] = useState([]);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState("");
  const running = useRef(false);

  const load = useCallback(async () => {
    try {
      const [all, ups, smp] = await Promise.all([signsApi.list(), signsApi.uploads(id), signsApi.samples(id, 48)]);
      const found = all.find((s) => String(s.id) === String(id));
      if (!found) throw new Error("This sign no longer exists.");
      setSign(found);
      setUploads(ups);
      setSamples(smp.filter((s) => s.thumb));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  const patch = (key, change) => setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...change } : it)));

  // Works through the queue one file at a time: each request waits for the ML service to extract landmarks.
  const drain = useCallback(async (items) => {
    if (running.current) return;
    running.current = true;
    for (const item of items) {
      patch(item.key, { state: "uploading", progress: 0 });
      try {
        const result = await signsApi.upload(id, item.file, (p) =>
          patch(item.key, p < 1 ? { state: "uploading", progress: p } : { state: "extracting" }),
        );
        patch(item.key, { state: "done", result });
      } catch (err) {
        patch(item.key, { state: "failed", error: errorMessage(err) });
      }
      await load();
    }
    running.current = false;
  }, [id, load]);

  const pending = useRef([]);
  const addFiles = (files) => {
    const items = files.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, state: "waiting", progress: 0 }));
    setQueue((q) => [...items, ...q]);
    pending.current.push(...items);
    if (!running.current) {
      // Drain everything queued so far, including files dropped while a batch is running.
      (async () => {
        while (pending.current.length) {
          const batch = pending.current.splice(0);
          await drain(batch);
        }
      })();
    }
  };

  const removeUpload = async (up) => {
    if (!window.confirm(`Delete ${up.filename} and its ${resultText(sign.kind, up)}?`)) return;
    try {
      await signsApi.removeUpload(up.id);
      toast(`Deleted ${up.filename}`);
      load();
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  const removeSign = async () => {
    if (!window.confirm(`Delete ${sign.label} and all ${sign.sample_count} of its samples? This can't be undone.`)) return;
    try {
      await signsApi.remove(sign.id);
      toast(`Deleted ${sign.label}`);
      navigate("/");
    } catch (err) {
      toast(errorMessage(err), "error");
    }
  };

  if (error) return <p className="rounded-sm bg-rust-wash px-3 py-2 text-body text-rust">{error}</p>;
  if (!sign) return <Spinner className="mx-auto mt-16" />;

  const target = targetFor(sign);
  const busy = queue.some((q) => q.state === "waiting" || q.state === "uploading" || q.state === "extracting");
  const isNone = sign.label === "_none";

  return (
    <>
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-meta font-medium text-ink-3 hover:text-ink">
        <ArrowLeft className="size-3.5" /> All signs
      </Link>

      <header className="mb-8 flex items-center gap-6">
        <div className="grid size-28 shrink-0 place-items-center rounded-lg bg-card shadow-lift">
          <Glyph label={sign.label} size="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-h1 font-semibold">{isNone ? "Not a sign" : `Letter ${sign.label}`}</h1>
            <Badge>
              {sign.kind === "static" ? <Hand className="size-3" /> : <Move className="size-3" />}
              {sign.kind === "static" ? "Held still" : "Moves"}
            </Badge>
          </div>
          <p className="mt-1 text-body text-ink-3">
            {isNone
              ? "Hand movement that isn't J or Z, e.g. moving between letters. Teaches the motion model what to ignore."
              : sign.sample_count >= target
                ? "Has enough data to train."
                : `Needs ${target - sign.sample_count} more ${sign.kind === "static" ? "samples" : "movements"} before it can be trained.`}
          </p>
          <div className="mt-3 flex max-w-sm items-center gap-3">
            <Readiness count={sign.sample_count} target={target} className="flex-1" />
            <span className="num text-meta font-medium text-ink-2">
              {sign.sample_count} <span className="text-ink-4">/ {target}</span>
            </span>
          </div>
        </div>
      </header>

      <section className="mb-8">
        <DropZone sign={sign} onFiles={addFiles} busy={busy} />
        {queue.length > 0 && (
          <div className="panel mt-3 overflow-hidden">
            <div className="flex items-center justify-between border-b border-rule px-4 py-2.5">
              <span className="eyebrow">This session</span>
              {!busy && (
                <button className="text-meta font-medium text-ink-3 hover:text-ink" onClick={() => setQueue([])}>
                  Clear
                </button>
              )}
            </div>
            <ul className="divide-y divide-rule">
              {queue.map((item) => (
                <QueueRow key={item.key} item={item} kind={sign.kind} />
              ))}
            </ul>
          </div>
        )}
      </section>

      {samples.length > 0 && (
        <section className="mb-8">
          <h2 className="eyebrow mb-3">What the camera saw</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2">
            {samples.map((s) => (
              <img
                key={s.id}
                src={s.thumb}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-sm object-cover outline outline-1 -outline-offset-1 outline-black/10"
              />
            ))}
          </div>
        </section>
      )}

      <section className="mb-8">
        <h2 className="eyebrow mb-3">Uploaded clips</h2>
        <div className="panel overflow-hidden">
          {uploads.length === 0 ? (
            <Empty icon={Film} title="No clips yet">
              Drop a few clips above. The videos are never stored: only the hand landmarks found in them and a few small preview frames.
            </Empty>
          ) : (
            <table className="w-full table-fixed text-left text-body">
              <thead>
                <tr className="border-b border-rule text-caption font-medium uppercase text-ink-3">
                  <th className="px-4 py-2.5 font-medium">Clip</th>
                  <th className="w-36 px-4 py-2.5 font-medium">Gave</th>
                  <th className="w-48 px-4 py-2.5 font-medium">Frames without a hand</th>
                  <th className="w-40 px-4 py-2.5 font-medium">Added</th>
                  <th className="w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {uploads.map((up) => (
                  <tr key={up.id} className="group">
                    <td className="truncate px-4 py-2.5 text-ink-2" title={up.filename}>{up.filename}</td>
                    <td className="num px-4 py-2.5 font-medium">{resultText(sign.kind, up)}</td>
                    <td className="num px-4 py-2.5 text-ink-3">{up.no_hand_frames}</td>
                    <td className="px-4 py-2.5 text-ink-3">{formatWhen(up.created_at)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button
                        onClick={() => removeUpload(up)}
                        className="rounded-sm p-2 text-ink-4 opacity-0 transition-opacity hover:bg-rust-wash hover:text-rust focus-visible:opacity-100 group-hover:opacity-100"
                        aria-label={`Delete ${up.filename}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {sign.kind === "motion" && !isNone && (
        <section className="mb-8">
          <h2 className="eyebrow mb-3">Recognition hint</h2>
          <div className="panel p-4">
            <StartShapes sign={sign} onSaved={load} />
          </div>
        </section>
      )}

      {!isNone && (
        <div className="flex justify-end border-t border-rule pt-5">
          <Button variant="danger" icon={Trash2} onClick={removeSign} disabled={busy}>
            Delete {sign.label}
          </Button>
        </div>
      )}
    </>
  );
}
