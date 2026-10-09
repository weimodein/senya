import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Hand, Move, Plus, Shapes, X } from "lucide-react";
import { signs as signsApi, targetFor, MIN_STATIC_SAMPLES } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Empty, Glyph, Readiness, Spinner } from "../components/ui.jsx";

function AddSign({ onAdded, onClose }) {
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState("static");
  const [startShapes, setStartShapes] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const shapes = startShapes.split(/[\s,]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
      const sign = await signsApi.create({
        label: label.trim().toUpperCase(),
        kind,
        start_shapes: kind === "motion" ? shapes : null,
      });
      toast(`Added ${sign.label}`);
      onAdded();
      setLabel("");
      setStartShapes("");
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="panel rise mb-6 flex flex-wrap items-end gap-3 p-4">
      <label className="flex w-28 flex-col gap-1.5">
        <span className="text-meta font-medium text-ink-2">Label</span>
        <input className="field uppercase" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="A" autoFocus required />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-meta font-medium text-ink-2">Kind</span>
        <div className="flex h-9 rounded-sm bg-well p-0.5">
          {[
            ["static", "Held still", Hand],
            ["motion", "Moves", Move],
          ].map(([value, text, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setKind(value)}
              className={`flex items-center gap-1.5 rounded-[5px] px-3 text-meta font-medium transition-colors ${
                kind === value ? "bg-card text-ink shadow-lift" : "text-ink-3 hover:text-ink"
              }`}
            >
              <Icon className="size-3.5" /> {text}
            </button>
          ))}
        </div>
      </div>
      {kind === "motion" && (
        <label className="flex w-44 flex-col gap-1.5">
          <span className="text-meta font-medium text-ink-2">Starts from</span>
          <input className="field uppercase" value={startShapes} onChange={(e) => setStartShapes(e.target.value)} placeholder="I" />
        </label>
      )}
      <Button variant="primary" type="submit" loading={busy} icon={Plus}>
        Add sign
      </Button>
      <Button variant="ghost" type="button" onClick={onClose} icon={X} className="ml-auto">
        Close
      </Button>
    </form>
  );
}

function SignTile({ sign }) {
  const target = targetFor(sign);
  const ready = sign.sample_count >= target;
  const unit = sign.kind === "static" ? "samples" : "moves";
  return (
    <Link
      to={`/signs/${sign.id}`}
      className="group flex flex-col rounded-lg bg-card p-3 shadow-lift transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-float active:scale-[0.98]"
    >
      <div className="flex items-start justify-between">
        <span className="eyebrow flex items-center gap-1" title={sign.kind === "static" ? "Held still" : "Moves"}>
          {sign.kind === "static" ? <Hand className="size-3" /> : <Move className="size-3" />}
        </span>
        {ready && <span className="size-1.5 rounded-full bg-leaf" title="Ready to train" />}
      </div>
      <div className="grid h-20 place-items-center">
        <Glyph label={sign.label} />
      </div>
      <Readiness count={sign.sample_count} target={target} />
      <div className="mt-1.5 flex items-baseline justify-between text-meta">
        <span className="num font-medium text-ink-2">
          {sign.sample_count}
          <span className="text-ink-4"> / {target}</span>
        </span>
        <span className="text-ink-4">{sign.label === "_none" ? "not a sign" : unit}</span>
      </div>
    </Link>
  );
}

export default function Signs() {
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    signsApi
      .list()
      .then((rows) => {
        setList(rows);
        setError("");
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(load, [load]);

  const staticSigns = (list || []).filter((s) => s.kind === "static");
  const motionSigns = (list || []).filter((s) => s.kind === "motion");
  const readyStatic = staticSigns.filter((s) => s.sample_count >= MIN_STATIC_SAMPLES).length;

  return (
    <>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold">Signs</h1>
          {list && (
            <p className="mt-1 text-body text-ink-3">
              <span className="num font-medium text-ink-2">{readyStatic}</span> of{" "}
              <span className="num">{staticSigns.length}</span> letters have enough clips to train
            </p>
          )}
        </div>
        {!adding && (
          <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>
            Add sign
          </Button>
        )}
      </header>

      {adding && <AddSign onAdded={load} onClose={() => setAdding(false)} />}
      {error && <p className="mb-4 rounded-sm bg-rust-wash px-3 py-2 text-body text-rust">{error}</p>}
      {!list && !error && <Spinner className="mx-auto mt-16" />}

      {list && staticSigns.length === 0 && motionSigns.length <= 1 && (
        <div className="panel">
          <Empty icon={Shapes} title="No letters yet">
            Add a letter, then upload a few short clips of the handshape. Each one needs {MIN_STATIC_SAMPLES} samples
            before it can be trained.
          </Empty>
        </div>
      )}

      {staticSigns.length > 0 && (
        <section className="mb-8">
          <h2 className="eyebrow mb-3 flex items-center gap-2">
            Held still <Badge>{staticSigns.length}</Badge>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {staticSigns.map((s) => (
              <SignTile key={s.id} sign={s} />
            ))}
          </div>
        </section>
      )}
      {motionSigns.length > 0 && (
        <section>
          <h2 className="eyebrow mb-3 flex items-center gap-2">
            Moves <Badge>{motionSigns.length}</Badge>
          </h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {[...motionSigns.filter((s) => s.label !== "_none"), ...motionSigns.filter((s) => s.label === "_none")].map((s) => (
              <SignTile key={s.id} sign={s} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
