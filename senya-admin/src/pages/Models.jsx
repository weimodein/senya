import { useState } from "react";
import useModels from "../hooks/useModels.js";
import { Badge, Button, Card, ErrorText, Loading, PageTitle, ProgressBar, formatDate, percent } from "../components/ui.jsx";

const STATUS = {
  deployed: { color: "blue", text: "On phones" },
  trained: { color: "green", text: "Ready" },
  training: { color: "yellow", text: "Training" },
  failed: { color: "red", text: "Failed" },
};

const letters = (m) => [...(m.labels || []), ...(m.motion_labels || []).filter((l) => l !== "_none")].join(" ") || "—";

export default function Models() {
  const m = useModels();
  const [actionError, setActionError] = useState("");
  const act = async (fn) => setActionError(await fn());

  const remove = (model) =>
    window.confirm(`Delete version ${model.version}?`) && act(() => m.remove(model.id));

  return (
    <>
      <PageTitle
        title="Models"
        subtitle={`${m.readyLetters} static letters ready to train (at least 2 needed)`}
        action={
          <Button variant="primary" disabled={!m.canTrain || m.busy} onClick={() => act(m.train)}>
            Train new version
          </Button>
        }
      />
      <ErrorText>{m.error || actionError}</ErrorText>
      {!m.models && !m.error && <Loading />}

      {m.training && (
        <Card title={`Training version ${m.training.version}`} className="mb-6">
          <ProgressBar value={m.training.progress || 0} color="yellow" />
          <p className="mt-2 text-sm text-gray-600">
            {Math.round((m.training.progress || 0) * 100)}% · {m.training.message || "Starting…"}
          </p>
          <div className="mt-3 flex items-center gap-3 text-sm">
            {m.trainingStuck && (
              <span className="text-red-700">
                The ML service didn't answer. On the laptop run <code>python -m app.cli run-job {m.training.id}</code>, or delete this run.
              </span>
            )}
            <Button variant="danger" className="ml-auto" onClick={() => remove(m.training)}>
              Delete run
            </Button>
          </div>
        </Card>
      )}

      {m.models && (
        <>
          <Card title="On phones now" className="mb-6">
            {m.live ? (
              <p>
                <span className="text-xl font-bold">Version {m.live.version}</span>
                <span className="ml-3 text-sm text-gray-600">
                  Letters: {letters(m.live)} · accuracy {percent(m.live.val_accuracy)} · deployed {formatDate(m.live.deployed_at)}
                </span>
              </p>
            ) : (
              <p className="text-gray-500">Nothing deployed yet.</p>
            )}
          </Card>

          <Card title="All versions">
            {m.models.length === 0 ? (
              <p className="text-sm text-gray-500">No versions yet. Train one once 2 letters are ready.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-gray-500">
                  <tr>
                    <th className="py-1">Version</th>
                    <th>Status</th>
                    <th>Letters</th>
                    <th>Accuracy</th>
                    <th>Trained</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {m.models.map((model) => {
                    const isOlder = m.live && model.version < m.live.version;
                    return (
                      <tr key={model.id} className="border-t border-gray-100">
                        <td className="py-2 font-semibold">v{model.version}</td>
                        <td>
                          <Badge color={STATUS[model.status].color}>{STATUS[model.status].text}</Badge>
                        </td>
                        <td>{model.status === "failed" ? <span className="text-red-700">{model.error}</span> : letters(model)}</td>
                        <td>
                          {percent(model.val_accuracy)}
                          {model.motion_labels && ` / ${percent(model.motion_val_accuracy)}`}
                        </td>
                        <td>{formatDate(model.trained_at)}</td>
                        <td className="space-x-2 text-right">
                          {model.status === "trained" && (
                            <Button variant="primary" disabled={m.busy} onClick={() => act(() => m.deploy(model.id))}>
                              {isOlder ? "Roll back" : "Deploy"}
                            </Button>
                          )}
                          {(model.status === "trained" || model.status === "failed") && (
                            <Button variant="danger" disabled={m.busy} onClick={() => remove(model)}>
                              Delete
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </>
  );
}
