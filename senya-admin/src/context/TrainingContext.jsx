import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { models as api } from "../api/index.js";
import { errorMessage } from "../api/client.js";
import { useAuth } from "./AuthContext.jsx";

/**
 * App-wide training tracker. Training runs on the server, so this only has to watch it: on login it picks up a run
 * that is already going (even after a page reload), then polls every 2 s until it finishes. The JobDock banner and
 * the Models page both read from here.
 *
 *   training  — the model row being trained, or null
 *   finished  — the row of a run that ended while watched ({status: "trained" | "failed"}), until dismissed
 *   changes   — bumped on every update, so pages showing the model list know to refetch
 */
const TrainingContext = createContext(null);
const POLL_MS = 2000;

export function TrainingProvider({ children }) {
  const { admin } = useAuth();
  const [training, setTraining] = useState(null);
  const [finished, setFinished] = useState(null);
  const [changes, setChanges] = useState(0);

  const watching = useRef(null); // id of the run being watched, read by the poll

  const check = useCallback(async () => {
    try {
      const list = await api.list();
      const running = list.find((m) => m.status === "training") || null;
      if (watching.current && watching.current !== running?.id) {
        // The run we were watching ended (or was deleted): keep its final row for the banner.
        const done = list.find((m) => m.id === watching.current);
        if (done) setFinished(done);
      }
      watching.current = running?.id ?? null;
      setTraining(running);
      setChanges((n) => n + 1);
    } catch {
      /* a failed poll just tries again next tick */
    }
  }, []);

  // Pick up a run that was already going when the panel opened.
  useEffect(() => {
    if (admin) check();
    else {
      watching.current = null;
      setTraining(null);
      setFinished(null);
    }
  }, [admin, check]);

  useEffect(() => {
    if (!training) return;
    const timer = setInterval(check, POLL_MS);
    return () => clearInterval(timer);
  }, [training?.id, check]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Starts a run. Returns an error message or "". */
  const startTraining = async () => {
    try {
      const model = await api.train();
      setFinished(null);
      watching.current = model.id;
      setTraining(model);
      setChanges((n) => n + 1);
      return "";
    } catch (err) {
      return errorMessage(err);
    }
  };

  return (
    <TrainingContext.Provider value={{ training, finished, changes, startTraining, refresh: check, dismissFinished: () => setFinished(null) }}>
      {children}
    </TrainingContext.Provider>
  );
}

export const useTraining = () => useContext(TrainingContext);
