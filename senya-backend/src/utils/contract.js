// Shapes from CONTRACT.md. Nothing else in the backend redefines them.
const FLOATS = 63;
const NONE_LABEL = "_none";
const MODEL_FILES = [
  "model.tflite", "labels.json", "golden.json",
  "motion.tflite", "motion_labels.json", "motion_config.json", "motion_golden.json",
];
const REQUIRED_FILES = MODEL_FILES.slice(0, 3);
const MOTION_FILES = MODEL_FILES.slice(3);
// Training data rules (spec §4.3). The trainer enforces the motion rules itself by skipping signs.
const MIN_STATIC_SAMPLES = 30;
const MIN_STATIC_SIGNS = 2;

const isLandmarks = (a) =>
  Array.isArray(a) && a.length === FLOATS && a.every((v) => typeof v === "number" && Number.isFinite(v));

/** Checks what the ML service's /extract returned before it goes into the database. Returns an error or null. */
function extractionError(kind, body) {
  if (!body || body.kind !== kind) return `expected a ${kind} result`;
  if (kind === "static") {
    if (!Array.isArray(body.samples) || !body.samples.length) return "no samples";
    const bad = body.samples.findIndex((s) => !isLandmarks(s?.landmarks));
    return bad >= 0 ? `samples[${bad}].landmarks must be ${FLOATS} finite numbers` : null;
  }
  if (!Array.isArray(body.sequences) || !body.sequences.length) return "no sequences";
  for (const [i, q] of body.sequences.entries()) {
    const f = q?.frames;
    if (!Array.isArray(f) || f.length < 2) return `sequences[${i}] needs at least 2 frames`;
    for (const fr of f) {
      if (!Number.isFinite(fr?.t_ms)) return `sequences[${i}] has a frame without t_ms`;
      if (fr.landmarks !== null && !isLandmarks(fr.landmarks)) return `sequences[${i}] has a bad frame`;
    }
    if (!f.some((fr) => fr.landmarks !== null)) return `sequences[${i}] has no frame with a hand`;
  }
  return null;
}

module.exports = {
  FLOATS, NONE_LABEL, MODEL_FILES, REQUIRED_FILES, MOTION_FILES, MIN_STATIC_SAMPLES, MIN_STATIC_SIGNS,
  isLandmarks, extractionError,
};
