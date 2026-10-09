import { useCallback, useEffect, useState } from "react";
import { models as api, signs as signsApi, MIN_STATIC_SAMPLES } from "../api/index.js";
import { errorMessage } from "../api/client.js";

/**
 * Model versions: training, deploying, rolling back. Pages/Models.jsx only renders what this returns.
 * While a version is training, this polls every 2 s so its progress bar moves.
 */
export default function useModels() {
  const [models, setModels] = useState(null); // null = still loading
  const [readyLetters, setReadyLetters] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [rows, signs] = await Promise.all([api.list(), signsApi.list()]);
      setModels(rows);
      setReadyLetters(signs.filter((s) => s.kind === "static" && s.sample_count >= MIN_STATIC_SAMPLES).length);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    reload();
  }, [reload]);

  const live = models?.find((m) => m.status === "deployed") || null;
  const training = models?.find((m) => m.status === "training") || null;
  // If the backend couldn't reach the ML service, the run's message says how to finish it from the laptop.
  const trainingStuck = Boolean(training?.message?.includes("run-job"));

  useEffect(() => {
    if (!training) return;
    const timer = setInterval(reload, 2000);
    return () => clearInterval(timer);
  }, [training?.id, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each action returns an error message or "".
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      return "";
    } catch (err) {
      return errorMessage(err);
    } finally {
      setBusy(false);
    }
  };

  return {
    models,
    live,
    training,
    trainingStuck,
    readyLetters,
    canTrain: !training && readyLetters >= 2,
    busy,
    error,
    train: () => run(api.train),
    deploy: (id) => run(() => api.deploy(id)),
    remove: (id) => run(() => api.remove(id)),
  };
}
