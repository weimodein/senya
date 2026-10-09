import { useCallback, useEffect, useRef, useState } from "react";
import { signs as api, targetFor } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { splitLabels } from "./useSigns.js";

/**
 * One sign: its data, its uploaded clips, preview frames, and the upload queue.
 * Pages/SignDetail.jsx only renders what this returns.
 *
 * Queue item: { key, file, status, progress, result, error }
 *   status: "waiting" | "uploading" | "extracting" | "done" | "failed"
 */
export default function useSign(id) {
  const [sign, setSign] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [queue, setQueue] = useState([]);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    try {
      const [all, ups, samples] = await Promise.all([api.list(), api.uploads(id), api.samples(id)]);
      const found = all.find((s) => String(s.id) === String(id));
      if (!found) throw new Error("This sign no longer exists.");
      setSign({ ...found, target: targetFor(found), ready: found.sample_count >= targetFor(found) });
      setUploads(ups);
      setPreviews(samples.filter((s) => s.thumb));
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    reload();
  }, [reload]);

  // ── Upload queue: files are sent one at a time, because each waits for the ML service ──
  const pending = useRef([]);
  const running = useRef(false);
  const update = (key, change) => setQueue((q) => q.map((it) => (it.key === key ? { ...it, ...change } : it)));

  const addFiles = (files) => {
    const items = [...files].map((file) => ({ key: `${file.name}-${Math.random()}`, file, status: "waiting", progress: 0 }));
    setQueue((q) => [...items, ...q]);
    pending.current.push(...items);
    if (running.current) return;
    running.current = true;
    (async () => {
      while (pending.current.length) {
        const item = pending.current.shift();
        update(item.key, { status: "uploading" });
        try {
          const result = await api.upload(id, item.file, (p) =>
            update(item.key, p < 1 ? { status: "uploading", progress: p } : { status: "extracting" }),
          );
          update(item.key, { status: "done", result });
        } catch (err) {
          update(item.key, { status: "failed", error: errorMessage(err) });
        }
        await reload();
      }
      running.current = false;
    })();
  };
  const clearQueue = () => setQueue((q) => q.filter((it) => !["done", "failed"].includes(it.status)));
  const uploading = queue.some((it) => ["waiting", "uploading", "extracting"].includes(it.status));

  // ── Actions; each returns an error message or "" ──
  const run = async (fn) => {
    try {
      await fn();
      return "";
    } catch (err) {
      return errorMessage(err);
    }
  };
  const deleteUpload = (uploadId) => run(async () => (await api.removeUpload(uploadId), reload()));
  const saveStartShapes = (text) => run(async () => (await api.update(id, { start_shapes: splitLabels(text) }), reload()));
  const deleteSign = () => run(() => api.remove(id));

  return { sign, uploads, previews, queue, uploading, error, addFiles, clearQueue, deleteUpload, saveStartShapes, deleteSign };
}
