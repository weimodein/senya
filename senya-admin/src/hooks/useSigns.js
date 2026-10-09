import { useCallback, useEffect, useState } from "react";
import { signs as api, targetFor } from "../api/index.js";
import { errorMessage } from "../api/client.js";

/** The list of signs, plus adding a new one. Pages/Signs.jsx only renders what this returns. */
export default function useSigns() {
  const [signs, setSigns] = useState(null); // null = still loading
  const [error, setError] = useState("");

  const reload = useCallback(() => {
    api
      .list()
      .then((rows) => {
        // Each sign gets its training target and whether it has reached it.
        setSigns(rows.map((s) => ({ ...s, target: targetFor(s), ready: s.sample_count >= targetFor(s) })));
        setError("");
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);
  useEffect(reload, [reload]);

  /** label: "A", kind: "static" | "motion", startShapes: "I" (motion only). Returns an error message or "". */
  const addSign = async ({ label, kind, startShapes }) => {
    try {
      await api.create({
        label: label.trim().toUpperCase(),
        kind,
        start_shapes: kind === "motion" ? splitLabels(startShapes) : null,
      });
      reload();
      return "";
    } catch (err) {
      return errorMessage(err);
    }
  };

  return { signs, error, addSign, reload };
}

export const splitLabels = (text = "") =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
