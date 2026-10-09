// Routes the ML service calls back on (docs/architecture.md §5.3). All behind X-API-Key.
const { QueryTypes } = require("sequelize");
const { sequelize, ModelVersion } = require("../models/index.js");
const { HttpError, intParam } = require("../middleware/errors.js");
const { saveTrained } = require("../services/modelStore.js");

/** Only a row that is still training accepts callbacks (it may have been deleted or failed meanwhile). */
async function trainingModel(id) {
  const model = await ModelVersion.findByPk(intParam(id));
  if (!model) throw new HttpError(404, "model not found");
  if (model.status !== "training") throw new HttpError(409, `model is ${model.status}, not training`);
  return model;
}

// GET /api/ml/dataset -> {signs: [{label, kind, start_shapes, uploads: [{id, samples | sequences}]}]}
// Uploads stay separate because the trainer splits by upload, never by frame.
const dataset = async (req, res) => {
  const signs = await sequelize.query("SELECT id, label, kind, start_shapes FROM signs ORDER BY id", {
    type: QueryTypes.SELECT,
  });
  const rows = await sequelize.query("SELECT sign_id, upload_id, data FROM samples ORDER BY id", {
    type: QueryTypes.SELECT,
  });
  const bySign = new Map(signs.map((s) => [s.id, new Map()]));
  for (const r of rows) {
    const uploads = bySign.get(r.sign_id);
    if (!uploads.has(r.upload_id)) uploads.set(r.upload_id, []);
    uploads.get(r.upload_id).push(r.data);
  }
  res.json({
    signs: signs.map((s) => ({
      label: s.label,
      kind: s.kind,
      start_shapes: s.start_shapes,
      uploads: [...bySign.get(s.id)].map(([id, items]) =>
        s.kind === "static" ? { id, samples: items } : { id, sequences: items.map((q) => ({ frames: q.frames })) },
      ),
    })),
  });
};

// POST /api/ml/models/:id/progress {progress, message}
const progress = async (req, res) => {
  const model = await trainingModel(req.params.id);
  const { progress: p = 0, message = "" } = req.body || {};
  await model.update({ progress: Math.min(1, Math.max(0, Number(p) || 0)), message: String(message).slice(0, 500) });
  res.status(204).end();
};

// POST /api/ml/models/:id/result  multipart: meta (JSON string) + contract files
const result = async (req, res) => {
  const model = await trainingModel(req.params.id);
  const files = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f.buffer]));
  let meta;
  try {
    meta = JSON.parse(req.body.meta || "{}");
  } catch {
    throw new HttpError(400, "meta is not valid JSON");
  }
  await saveTrained(model, files, meta);
  res.status(204).end();
};

// POST /api/ml/models/:id/fail {error}
const fail = async (req, res) => {
  const model = await trainingModel(req.params.id);
  await model.update({
    status: "failed",
    error: String((req.body || {}).error || "unknown error").slice(0, 2000),
    message: "training failed",
  });
  res.status(204).end();
};

module.exports = { dataset, progress, result, fail };
