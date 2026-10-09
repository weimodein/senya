// Bottom-right banners for work that keeps running while the admin moves between pages:
// the upload queue and the training run. Shown on every page (rendered by Layout).
import { Link } from "react-router-dom";
import { isActive, useUploadQueue } from "../context/UploadQueueContext.jsx";
import { useTraining } from "../context/TrainingContext.jsx";
import { Button, ProgressBar } from "./ui.jsx";

const STEP = { waiting: "Waiting", uploading: "Uploading", extracting: "Finding the hand" };

function DockCard({ children }) {
  return <div className="w-80 rounded-lg border border-gray-200 bg-white p-3 text-sm shadow-lg">{children}</div>;
}

function UploadCard() {
  const { items, clearFinished } = useUploadQueue();
  if (items.length === 0) return null;
  const finished = items.filter((it) => !isActive(it));
  const failed = items.filter((it) => it.status === "failed");
  const current = items.find((it) => it.status === "uploading" || it.status === "extracting");
  const done = finished.length === items.length;
  // Link to the sign of the file in progress, or of the last file once everything is done.
  const signId = (current || items[items.length - 1]).signId;

  return (
    <DockCard>
      <div className="mb-2 flex items-center justify-between">
        <span className="font-semibold">
          {done ? "Uploads finished" : "Uploading clips"} · {finished.length} of {items.length}
        </span>
        {done && (
          <button onClick={clearFinished} className="text-gray-400 hover:text-gray-700" aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
      <ProgressBar value={finished.length / items.length} color={failed.length ? "yellow" : "blue"} />
      <p className="mt-2 truncate text-gray-600">
        {current
          ? `${current.signLabel} · ${current.file.name} · ${STEP[current.status]}…`
          : failed.length
            ? `${failed.length} failed: ${failed[0].error}`
            : "All clips processed."}
      </p>
      <Link to={`/signs/${signId}`} className="mt-1 inline-block text-blue-600 hover:underline">
        View sign
      </Link>
    </DockCard>
  );
}

function TrainingCard() {
  const { training, finished, dismissFinished } = useTraining();
  if (training) {
    const pct = Math.round((training.progress || 0) * 100);
    return (
      <DockCard>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-semibold">Training version {training.version}</span>
          <span className="text-gray-600">{pct}%</span>
        </div>
        <ProgressBar value={training.progress || 0} color="yellow" />
        <p className="mt-2 truncate text-gray-600">{training.message || "Starting…"}</p>
        <Link to="/models" className="mt-1 inline-block text-blue-600 hover:underline">
          Open models
        </Link>
      </DockCard>
    );
  }
  if (!finished) return null;
  const ok = finished.status === "trained";
  return (
    <DockCard>
      <div className="flex items-center justify-between">
        <span className={`font-semibold ${ok ? "text-green-700" : "text-red-700"}`}>
          {ok ? `Version ${finished.version} is ready to deploy` : `Version ${finished.version} failed`}
        </span>
        <button onClick={dismissFinished} className="text-gray-400 hover:text-gray-700" aria-label="Dismiss">
          ✕
        </button>
      </div>
      {!ok && finished.error && <p className="mt-1 truncate text-gray-600">{finished.error}</p>}
      <Link to="/models" className="mt-2 inline-block">
        <Button variant={ok ? "primary" : "default"}>Open models</Button>
      </Link>
    </DockCard>
  );
}

export default function JobDock() {
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <TrainingCard />
      <UploadCard />
    </div>
  );
}
