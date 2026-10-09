import { useCallback, useEffect, useState } from "react";
import { signs as api, targetFor } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { isActive, useUploadQueue } from "../context/UploadQueueContext.jsx";
import { splitLabels } from "./useSigns.js";

/**
 * One sign: its data, its uploaded clips, preview frames, and this sign's part of the upload queue.
 * Pages/SignDetail.jsx only renders what this returns. The queue itself is app-wide (UploadQueueContext), so
 * uploads keep going when the admin leaves this page.
 *
 * Queue item: { key, file, status, progress, result, error }
 *   status: "waiting" | "uploading" | "extracting" | "done" | "failed"
 */
export default function useSign(id) {
  const uploadsQueue = useUploadQueue();
  const [sign, setSign] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [previews, setPreviews] = useState([]);
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
  // Refetch on open, and whenever any queued file finishes (its samples change the counts).
  useEffect(() => {
    reload();
  }, [reload, uploadsQueue.finishedCount]);

  const queue = uploadsQueue.items.filter((it) => String(it.signId) === String(id));
  const uploading = queue.some(isActive);

  // ── Actions; each returns an error message or "" ──
  const run = async (fn) => {
    try {
      await fn();
      return "";
    } catch (err) {
      return errorMessage(err);
    }
  };
  const addFiles = (files) => sign && uploadsQueue.addFiles(sign, files);
  const deleteUpload = (uploadId) => run(async () => (await api.removeUpload(uploadId), reload()));
  const saveStartShapes = (text) => run(async () => (await api.update(id, { start_shapes: splitLabels(text) }), reload()));
  const deleteSign = () => run(() => api.remove(id));

  return {
    sign,
    uploads,
    previews,
    queue,
    uploading,
    error,
    addFiles,
    clearQueue: uploadsQueue.clearFinished,
    deleteUpload,
    saveStartShapes,
    deleteSign,
  };
}
