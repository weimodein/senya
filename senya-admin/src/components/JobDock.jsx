// Persistent work status for uploads and training that continue while the admin changes pages.
import { Link } from "react-router-dom";
import { isActive, useUploadQueue } from "../context/UploadQueueContext.jsx";
import { useTraining } from "../context/TrainingContext.jsx";
import { Badge, Button, ProgressBar } from "./ui.jsx";

const STEP = { waiting: "Waiting", uploading: "Uploading", extracting: "Finding the hand" };

function DockCard({ children }) {
  return <div className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[#DDE4ED] bg-white p-4 text-sm shadow-[0_12px_34px_rgba(32,38,48,0.12)]">{children}</div>;
}

function UploadCard() {
  const { items, clearFinished } = useUploadQueue();
  if (items.length === 0) return null;
  const finished = items.filter((item) => !isActive(item));
  const failed = items.filter((item) => item.status === "failed");
  const current = items.find((item) => item.status === "uploading" || item.status === "extracting");
  const done = finished.length === items.length;
  const signId = (current || items[items.length - 1]).signId;

  return (
    <DockCard>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="font-bold text-[#202630]">{done ? "Uploads finished" : "Uploading clips"} · {finished.length} of {items.length}</span>
        {done && <button onClick={clearFinished} className="text-xl leading-none text-[#98A2B3] hover:text-[#202630]" aria-label="Dismiss">×</button>}
      </div>
      <ProgressBar value={finished.length / items.length} color={failed.length ? "yellow" : "blue"} />
      <p className="mt-3 truncate text-[#636B77]">
        {current ? `${current.signLabel} · ${current.file.name} · ${STEP[current.status]}…` : failed.length ? `${failed.length} failed: ${failed[0].error}` : "All clips processed."}
      </p>
      <Link to={`/signs/${signId}`} className="mt-3 inline-flex min-h-9 items-center font-semibold text-[#32669A] hover:underline">View sign</Link>
    </DockCard>
  );
}

function TrainingCard() {
  const { training, finished, dismissFinished } = useTraining();
  if (training) {
    const pct = Math.round((training.progress || 0) * 100);
    return (
      <DockCard>
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-bold text-[#202630]">Training v{training.version}</span>
          <Badge color="yellow">{pct}%</Badge>
        </div>
        <ProgressBar value={training.progress || 0} color="yellow" />
        <p className="mt-3 truncate text-[#636B77]">{training.message || "Waiting to start"}</p>
        <Link to="/models" className="mt-3 inline-flex min-h-9 items-center font-semibold text-[#32669A] hover:underline">View training</Link>
      </DockCard>
    );
  }
  if (!finished) return null;
  const ok = finished.status === "trained";
  return (
    <DockCard>
      <div className="flex items-center justify-between gap-3">
        <span className={`font-bold ${ok ? "text-[#177245]" : "text-[#B34B4B]"}`}>{ok ? `Version ${finished.version} is ready to publish` : `Version ${finished.version} failed`}</span>
        <button onClick={dismissFinished} className="text-xl leading-none text-[#98A2B3] hover:text-[#202630]" aria-label="Dismiss">×</button>
      </div>
      {!ok && finished.error && <p className="mt-2 truncate text-[#636B77]">{finished.error}</p>}
      <Link to="/models" className="mt-3 inline-block"><Button variant={ok ? "primary" : "default"}>Open models</Button></Link>
    </DockCard>
  );
}

export default function JobDock() {
  return <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-3"><TrainingCard /><UploadCard /></div>;
}
