import { useCallback, useEffect, useState } from "react";
import { Boxes, CircleAlert, Play, RotateCcw, Rocket, Smartphone, Trash2 } from "lucide-react";
import { models as modelsApi, signs as signsApi, MIN_STATIC_SAMPLES } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { useToast } from "../context/ToastContext.jsx";
import { Badge, Button, Empty, Spinner, formatWhen, pct } from "../components/ui.jsx";

const STATUS = {
  deployed: ["live", "On phones"],
  trained: ["ok", "Ready"],
  training: ["busy", "Training"],
  failed: ["bad", "Failed"],
};

function Labels({ labels, motion }) {
  if (!labels?.length && !motion?.length) return <span className="text-ink-4">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {[...(labels || []), ...(motion || []).filter((l) => l !== "_none")].map((l) => (
        <span key={l} className="grid h-6 min-w-6 place-items-center rounded-[5px] bg-well px-1.5 font-glyph text-[13px] font-semibold">
          {l}
        </span>
      ))}
    </span>
  );
}

/** The run in progress: the one thing on this page that changes by itself. */
function TrainingCard({ model, onDelete }) {
  const stuck = model.message?.includes("run-job");
  return (
    <div className="panel rise mb-6 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Spinner className={stuck ? "hidden" : "text-ochre"} />
          <span className="text-h3 font-semibold">Training version {model.version}</span>
        </div>
        <span className="num text-h3 font-semibold text-ochre">{Math.round((model.progress || 0) * 100)}%</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-well">
        <div
          className="h-full rounded-full bg-ochre transition-[width] duration-700 ease-out"
          style={{ width: `${Math.max(2, (model.progress || 0) * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-4">
        <p className={`text-meta ${stuck ? "text-rust" : "text-ink-3"}`}>
          {stuck ? (
            <>
              The ML service didn't answer. On the laptop, run <code className="rounded bg-well px-1 py-0.5 text-ink">python -m app.cli run-job {model.id}</code>, or delete this run and try again.
            </>
          ) : (
            model.message || "Starting…"
          )}
        </p>
        {stuck && (
          <Button size="sm" variant="danger" icon={Trash2} onClick={() => onDelete(model)}>
            Delete run
          </Button>
        )}
      </div>
    </div>
  );
}

function LiveCard({ live }) {
  return (
    <div className="panel flex items-center gap-5 p-5">
      <div className="grid size-12 shrink-0 place-items-center rounded-md bg-clay-wash">
        <Smartphone className="size-5 text-clay" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="eyebrow">On phones now</div>
        {live ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="num text-h1 font-semibold">Version {live.version}</span>
            <span className="text-body text-ink-3">
              Letters <span className="num font-medium text-ink-2">{pct(live.val_accuracy)}</span>
              {live.motion_labels && (
                <>
                  {" · "}Motion <span className="num font-medium text-ink-2">{pct(live.motion_val_accuracy)}</span>
                </>
              )}
              {" · "}deployed {formatWhen(live.deployed_at)}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-h2 font-medium text-ink-3">Nothing deployed yet</div>
        )}
      </div>
      {live && (
        <div className="hidden max-w-[40%] md:block">
          <Labels labels={live.labels} motion={live.motion_labels} />
        </div>
      )}
    </div>
  );
}

export default function Models() {
  const toast = useToast();
  const [list, setList] = useState(null);
  const [readySigns, setReadySigns] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(null); // id of the row whose action is running, or "train"

  const load = useCallback(async () => {
    try {
      const [rows, signs] = await Promise.all([modelsApi.list(), signsApi.list()]);
      setList(rows);
      setReadySigns(signs.filter((s) => s.kind === "static" && s.sample_count >= MIN_STATIC_SAMPLES).length);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const training = list?.find((m) => m.status === "training");
  // Poll while a run is going; progress arrives from the ML service via the backend.
  useEffect(() => {
    if (!training) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [training?.id, load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tell the admin when a run they were watching finishes.
  const [watching, setWatching] = useState(null);
  useEffect(() => {
    if (training) return setWatching(training.id);
    if (!watching || !list) return;
    const done = list.find((m) => m.id === watching);
    if (done?.status === "trained") toast(`Version ${done.version} is ready to deploy`);
    if (done?.status === "failed") toast(`Version ${done.version} failed: ${done.error}`, "error");
    setWatching(null);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (key, fn, success) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast(success);
      await load();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  };

  const live = list?.find((m) => m.status === "deployed") || null;
  const remove = (m) =>
    window.confirm(`Delete version ${m.version}? Its files are removed for good.`) &&
    act(m.id, () => modelsApi.remove(m.id), `Deleted version ${m.version}`);

  return (
    <>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-h1 font-semibold">Models</h1>
          {readySigns !== null && (
            <p className="mt-1 text-body text-ink-3">
              <span className="num font-medium text-ink-2">{readySigns}</span> letter{readySigns === 1 ? "" : "s"} ready to
              train{readySigns < 2 && <> · need at least 2</>}
            </p>
          )}
        </div>
        <Button
          variant="primary"
          icon={Play}
          loading={busy === "train"}
          disabled={Boolean(training) || readySigns < 2}
          onClick={() => act("train", modelsApi.train, "Training started")}
        >
          Train new version
        </Button>
      </header>

      {error && <p className="mb-4 rounded-sm bg-rust-wash px-3 py-2 text-body text-rust">{error}</p>}
      {!list && !error && <Spinner className="mx-auto mt-16" />}

      {list && (
        <>
          {training && <TrainingCard model={training} onDelete={remove} />}
          <section className="mb-8">
            <LiveCard live={live} />
          </section>

          <section>
            <h2 className="eyebrow mb-3">All versions</h2>
            <div className="panel overflow-hidden">
              {list.length === 0 ? (
                <Empty icon={Boxes} title="No versions yet">
                  Once at least two letters have {MIN_STATIC_SAMPLES} samples each, train the first version here.
                </Empty>
              ) : (
                <ul className="divide-y divide-rule">
                  {list.map((m) => {
                    const [tone, text] = STATUS[m.status];
                    const older = live && m.version < live.version;
                    return (
                      <li key={m.id} className={`flex items-center gap-4 px-4 py-3 ${m.status === "deployed" ? "bg-clay-wash/40" : ""}`}>
                        <span className="num w-10 shrink-0 text-h3 font-semibold text-ink">v{m.version}</span>
                        <Badge tone={tone} className="w-24 justify-center">
                          {text}
                        </Badge>
                        <div className="min-w-0 flex-1">
                          {m.status === "failed" ? (
                            <span className="flex items-center gap-1.5 text-meta text-rust" title={m.error}>
                              <CircleAlert className="size-3.5 shrink-0" />
                              <span className="truncate">{m.error}</span>
                            </span>
                          ) : (
                            <Labels labels={m.labels} motion={m.motion_labels} />
                          )}
                        </div>
                        <span className="num w-28 shrink-0 text-right text-meta text-ink-3" title="Validation accuracy (letters · motion)">
                          {pct(m.val_accuracy)}
                          {m.motion_labels && <span className="text-ink-4"> · {pct(m.motion_val_accuracy)}</span>}
                        </span>
                        <span className="w-28 shrink-0 text-right text-meta text-ink-4">{formatWhen(m.trained_at || m.created_at)}</span>
                        <span className="flex w-40 shrink-0 justify-end gap-1">
                          {m.status === "trained" && (
                            <Button
                              size="sm"
                              variant={older ? "secondary" : "primary"}
                              icon={older ? RotateCcw : Rocket}
                              loading={busy === m.id}
                              onClick={() =>
                                act(m.id, () => modelsApi.deploy(m.id), `Version ${m.version} is now on phones`)
                              }
                            >
                              {older ? "Roll back" : "Deploy"}
                            </Button>
                          )}
                          {m.status !== "deployed" && m.status !== "training" && (
                            <button
                              onClick={() => remove(m)}
                              className="rounded-sm p-2 text-ink-4 transition-colors hover:bg-rust-wash hover:text-rust"
                              aria-label={`Delete version ${m.version}`}
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </>
  );
}
