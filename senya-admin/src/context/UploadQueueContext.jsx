import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { signs as api } from "../api/index.js";
import { errorMessage } from "../api/client.js";

/**
 * App-wide upload queue. It lives above the routes, so uploads keep going (and stay visible in the JobDock banner)
 * while the admin moves between pages. Files are sent one at a time, because each waits for the ML service.
 *
 * Item: { key, signId, signLabel, file, status, progress, result, error }
 *   status: "waiting" | "uploading" | "extracting" | "done" | "failed"
 */
const UploadQueueContext = createContext(null);

const ACTIVE = ["waiting", "uploading", "extracting"];

export function UploadQueueProvider({ children }) {
  const [items, setItems] = useState([]);
  // Bumped after every finished file, so pages showing sample counts know to refetch.
  const [finishedCount, setFinishedCount] = useState(0);
  const pending = useRef([]);
  const running = useRef(false);

  const update = (key, change) => setItems((list) => list.map((it) => (it.key === key ? { ...it, ...change } : it)));

  const work = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    while (pending.current.length) {
      const item = pending.current.shift();
      update(item.key, { status: "uploading" });
      try {
        const result = await api.upload(item.signId, item.file, (p) =>
          update(item.key, p < 1 ? { status: "uploading", progress: p } : { status: "extracting" }),
        );
        update(item.key, { status: "done", result });
      } catch (err) {
        update(item.key, { status: "failed", error: errorMessage(err) });
      }
      setFinishedCount((n) => n + 1);
    }
    running.current = false;
  }, []);

  /** sign: { id, label, kind }, files: FileList or array */
  const addFiles = (sign, files) => {
    const added = [...files].map((file) => ({
      key: `${sign.id}-${file.name}-${Math.random()}`,
      signId: sign.id,
      signLabel: sign.label,
      kind: sign.kind,
      file,
      status: "waiting",
      progress: 0,
    }));
    setItems((list) => [...list, ...added]);
    pending.current.push(...added);
    work();
  };

  const clearFinished = () => setItems((list) => list.filter((it) => ACTIVE.includes(it.status)));
  const active = items.some((it) => ACTIVE.includes(it.status));

  // Closing or reloading the tab would drop the files still waiting: ask first.
  useEffect(() => {
    if (!active) return;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [active]);

  return (
    <UploadQueueContext.Provider value={{ items, active, finishedCount, addFiles, clearFinished }}>
      {children}
    </UploadQueueContext.Provider>
  );
}

export const useUploadQueue = () => useContext(UploadQueueContext);
export const isActive = (item) => ACTIVE.includes(item.status);
