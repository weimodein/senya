import { useState } from "react";
import useModels from "../hooks/useModels.js";
import { Badge, Button, Card, ConfirmDialog, ErrorText, Loading, PageTitle, ProgressBar, formatDate, percent } from "../components/ui.jsx";

const STATUS = {
  deployed: { color: "blue", text: "Published" },
  trained: { color: "green", text: "Ready" },
  training: { color: "yellow", text: "Training" },
  failed: { color: "red", text: "Failed" },
};

const cleanLabels = (labels = []) => labels.filter((label) => label !== "_none");
const staticLetters = (model) => cleanLabels(model.labels || []);
const motionLetters = (model) => cleanLabels(model.motion_labels || []);
const labelsText = (labels) => labels.join(", ") || "—";

function PublishedSummary({ model }) {
  if (!model) {
    return <Card eyebrow="Published version" title="No published version" className="mb-7"><p className="text-sm text-[#636B77]">Train and publish a model before phones can download an update.</p></Card>;
  }

  const staticLabels = staticLetters(model);
  const motion = motionLetters(model);

  return (
    <Card eyebrow="Published version" title={`v${model.version}`} action={<Badge color="blue">Published</Badge>} className="mb-7">
      <div className="grid gap-5 md:grid-cols-[minmax(0,1.4fr)_minmax(220px,1fr)]">
        <div>
          <p className="text-sm font-semibold text-[#202630]">Available for phone downloads</p>
          <p className="mt-3 text-sm text-[#636B77]">Static result · Letters {labelsText(staticLabels)} · {model.val_accuracy == null ? "Accuracy unavailable" : `Reported accuracy ${percent(model.val_accuracy)}`}</p>
          {motion.length > 0 && <p className="mt-1 text-sm text-[#636B77]">Motion result · Letters {labelsText(motion)} · {model.motion_val_accuracy == null ? "Accuracy unavailable" : `Reported accuracy ${percent(model.motion_val_accuracy)}`}</p>}
          <p className="mt-3 text-xs text-[#7A8493]">Evaluation method not shown.</p>
        </div>
        <div className="md:border-l md:border-[#E6EBF1] md:pl-5">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#7A8493]">Published</p>
          <p className="mt-2 text-sm font-semibold text-[#364152]">{formatDate(model.deployed_at || model.trained_at)}</p>
          <p className="mt-2 text-sm text-[#636B77]">Phones update when they connect.</p>
        </div>
      </div>
    </Card>
  );
}

function TrainingCard({ training, stuck, onRemove, busy }) {
  if (!training) return null;
  const progress = training.progress || 0;

  return (
    <Card eyebrow="Models · training" title={`Training v${training.version}`} action={<Badge color="yellow">Training</Badge>} className="mb-7">
      <div className="flex items-center justify-between gap-4 text-sm font-semibold text-[#364152]">
        <span>{Math.round(progress * 100)}%</span>
        <span className="text-right text-[#636B77]">{training.message || "Waiting to start"}</span>
      </div>
      <ProgressBar value={progress} color="yellow" className="mt-3" />
      <div className="mt-4 flex flex-col gap-3 text-sm text-[#636B77] sm:flex-row sm:items-center sm:justify-between">
        <span>{stuck ? "The ML service did not respond to this run." : "The published version remains available while this run continues."}</span>
        <Button variant="danger" disabled={busy} onClick={() => onRemove(training)}>Remove this training run.</Button>
      </div>
    </Card>
  );
}

function VersionTable({ models, live, busy, onDeploy, onRemove }) {
  if (models.length === 0) return <p className="text-sm text-[#636B77]">No versions yet. Train one once two static letters are ready.</p>;

  return (
    <div className="table-scroll">
      <table className="refined-table">
        <thead>
          <tr>
            <th>Version</th>
            <th>Status</th>
            <th>Static coverage</th>
            <th>Static accuracy</th>
            <th>Motion</th>
            <th>Trained</th>
            <th className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {models.map((model) => {
            const status = STATUS[model.status] || STATUS.failed;
            const isOlder = live && model.version < live.version;
            const motion = motionLetters(model);
            return (
              <tr key={model.id}>
                <td className="font-bold text-[#202630]">v{model.version}</td>
                <td><Badge color={status.color}>{status.text}</Badge></td>
                <td>{model.status === "failed" ? <span className="text-[#B34B4B]">{model.error}</span> : labelsText(staticLetters(model))}</td>
                <td>{model.val_accuracy == null ? "Unavailable" : percent(model.val_accuracy)}</td>
                <td>{motion.length ? labelsText(motion) : "Not included"}</td>
                <td className="whitespace-nowrap">{formatDate(model.trained_at)}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    {model.status === "trained" && <Button variant="default" disabled={busy} onClick={() => onDeploy(model.id)}>{isOlder ? "Roll back" : "Publish"}</Button>}
                    {(model.status === "trained" || model.status === "failed") && <Button variant="quiet" disabled={busy} onClick={() => onRemove(model)}>Delete</Button>}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Models() {
  const m = useModels();
  const [actionError, setActionError] = useState("");
  const [pendingDelete, setPendingDelete] = useState(null);
  const act = async (fn) => setActionError(await fn());
  const remove = (model) => setPendingDelete(model);
  const confirmRemove = async () => {
    if (!pendingDelete) return;
    const model = pendingDelete;
    setPendingDelete(null);
    setActionError(await m.remove(model.id));
  };
  const removingTraining = pendingDelete?.status === "training";

  return (
    <>
      <PageTitle
        eyebrow="Models"
        title="Models"
        subtitle={`${m.readyLetters} static letters ready to train · at least 2 needed`}
        action={<Button variant="primary" disabled={!m.canTrain || m.busy} onClick={() => act(m.train)}>Train new version</Button>}
      />
      <ErrorText>{m.error || actionError}</ErrorText>
      {!m.models && !m.error && <Loading />}

      {m.models && (
        <>
          <TrainingCard training={m.training} stuck={m.trainingStuck} onRemove={remove} busy={m.busy} />
          <PublishedSummary model={m.live} />
          <Card title="All versions">
            <VersionTable models={m.models} live={m.live} busy={m.busy} onDeploy={(id) => act(() => m.deploy(id))} onRemove={remove} />
          </Card>
          <p className="mt-5 text-sm text-[#636B77]">Publishing makes a version available; phones update when they connect.</p>
        </>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title={removingTraining ? "Remove training run?" : "Delete model version?"}
        description={removingTraining ? "This removes the active training run. The published version stays available." : `Delete version ${pendingDelete?.version}? This cannot be undone.`}
        confirmLabel={removingTraining ? "Remove run" : "Delete version"}
        onConfirm={confirmRemove}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
