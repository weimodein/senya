// The ONLY place the backend calls the ML service (docs/architecture.md §5.4). X-API-Key on every call.
const axios = require("axios");
const FormData = require("form-data");
const { HttpError } = require("../middleware/errors.js");

const base = () => (process.env.ML_SERVICE_URL || "http://localhost:8001").replace(/\/+$/, "");
const headers = () => ({
  "X-API-Key": process.env.ML_API_KEY,
  // The laptop is reached through an ngrok tunnel; skip its browser interstitial.
  "ngrok-skip-browser-warning": "1",
});

/** Turns an axios failure into an HttpError the admin panel can show as-is. */
function toHttpError(err) {
  if (!err.response) {
    return new HttpError(503, "ML service is unreachable. Is the laptop running senya-ml (and the tunnel)?");
  }
  const detail = err.response.data?.detail || err.response.data?.message || err.message;
  if (err.response.status === 422) return new HttpError(422, String(detail));
  if (err.response.status === 409) return new HttpError(409, `ML service is busy: ${detail}`);
  return new HttpError(502, `ML service error: ${detail}`);
}

/** One uploaded file -> extracted landmarks. The file is never stored by either service. */
async function extract(buffer, filename, kind) {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", buffer, { filename });
  try {
    const res = await axios.post(`${base()}/extract`, form, {
      headers: { ...form.getHeaders(), ...headers() },
      timeout: 180_000, // a long 1080p clip takes ~15 s on a laptop; leave headroom
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    return res.data;
  } catch (err) {
    throw toHttpError(err);
  }
}

/** Asks the ML service to train model row `modelId`. Returns at once (202); results arrive via /api/ml/*. */
async function train(modelId) {
  try {
    await axios.post(`${base()}/train`, { model_id: modelId }, { headers: headers(), timeout: 15_000 });
  } catch (err) {
    throw toHttpError(err);
  }
}

module.exports = { extract, train };
