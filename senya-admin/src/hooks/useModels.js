import { useCallback, useEffect, useState } from "react";
import { models as api, signs as signsApi, MIN_STATIC_SAMPLES } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { useTraining } from "../context/TrainingContext.jsx";

/**
 * Model versions: training, deploying, rolling back. Pages/Models.jsx only renders what this returns.
 * The run in progress is tracked app-wide (TrainingContext), so it keeps updating on every page.
 */
export default function useModels() {
  const trainingJob = useTraining();
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
  // Refetch on open and whenever the training tracker sees a change (progress, finish).
  useEffect(() => {
    reload();
  }, [reload, trainingJob.changes]);

  const training = trainingJob.training;
  // If the backend couldn't reach the ML service, the run's message says how to finish it from the laptop.
  const trainingStuck = Boolean(training?.message?.includes("run-job"));

  // Each action returns an error message or "".
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
      await Promise.all([reload(), trainingJob.refresh()]);
      return "";
    } catch (err) {
      return errorMessage(err);
    } finally {
      setBusy(false);
    }
  };

  return {
    models,
    live: models?.find((m) => m.status === "deployed") || null,
    training,
    trainingStuck,
    readyLetters,
    canTrain: !training && readyLetters >= 2,
    busy,
    error,
    train: trainingJob.startTraining,
    deploy: (id) => run(() => api.deploy(id)),
    remove: (id) => run(() => api.remove(id)),
  };
}
