const { QueryTypes, UniqueConstraintError } = require("sequelize");
const { sequelize, ModelVersion, ModelFile } = require("../models/index.js");
const { HttpError, intParam } = require("../middleware/errors.js");
const { MIN_STATIC_SAMPLES, MIN_STATIC_SIGNS } = require("../utils/contract.js");
const { nextVersion } = require("../services/modelStore.js");
const ml = require("../services/mlClient.js");

const LIST_FIELDS = [
  "id", "version", "status", "progress", "message", "error", "labels", "motion_labels",
  "val_accuracy", "motion_val_accuracy", "created_at", "trained_at", "deployed_at",
];

async function findModel(id) {
  const model = await ModelVersion.findByPk(intParam(id));
  if (!model) throw new HttpError(404, "model not found");
  return model;
}

// ── Public: the Android app (CONTRACT.md §3 items 9–10; frozen) ─────────────

// GET /api/model/latest
const latest = async (req, res) => {
  const model = await ModelVersion.findOne({ where: { status: "deployed" } });
  if (!model) return res.status(404).json({ message: "no model published" });
  const files = await ModelFile.findAll({ where: { model_id: model.id }, attributes: ["name", "sha256"] });
  const sha = Object.fromEntries(files.map((f) => [f.name, f.sha256]));
  const base = `/models/v${model.version}`;
  res.json({
    version: model.version,
    model_url: `${base}/model.tflite`,
    labels_url: `${base}/labels.json`,
    sha256: sha["model.tflite"],
    motion: sha["motion.tflite"]
      ? {
          model_url: `${base}/motion.tflite`,
          labels_url: `${base}/motion_labels.json`,
          config_url: `${base}/motion_config.json`,
          sha256: sha["motion.tflite"],
        }
      : null,
  });
};

// GET /models/v:version/:name  (any version that still exists, so a phone mid-download survives a new deploy)
const file = async (req, res) => {
  const [row] = await sequelize.query(
    `SELECT f.content FROM model_files f JOIN model_versions m ON m.id = f.model_id
      WHERE m.version = :version AND f.name = :name`,
    { replacements: { version: intParam(req.params.version), name: req.params.name }, type: QueryTypes.SELECT },
  );
  if (!row) return res.status(404).json({ message: "not found" });
  res.type(req.params.name.endsWith(".json") ? "application/json" : "application/octet-stream");
  res.set("Cache-Control", "public, max-age=31536000, immutable"); // a version's files never change
  res.send(row.content);
};

// ── Admin ───────────────────────────────────────────────────────────────────

// GET /api/models
const list = async (req, res) => {
  res.json(await ModelVersion.findAll({ attributes: LIST_FIELDS, order: [["version", "DESC"]] }));
};

// GET /api/models/:id
const get = async (req, res) => res.json(await findModel(req.params.id));

// POST /api/models/train
const train = async (req, res) => {
  const counts = await sequelize.query(
    `SELECT s.label, (SELECT count(*) FROM samples x WHERE x.sign_id = s.id)::int AS n
       FROM signs s WHERE s.kind = 'static'`,
    { type: QueryTypes.SELECT },
  );
  const ready = counts.filter((c) => c.n >= MIN_STATIC_SAMPLES);
  if (ready.length < MIN_STATIC_SIGNS) {
    throw new HttpError(
      400,
      `Need at least ${MIN_STATIC_SIGNS} static signs with ${MIN_STATIC_SAMPLES}+ samples (have ${ready.length}).`,
    );
  }

  // Checked before taking a version number, so a refused click doesn't burn one. The unique index on
  // status = 'training' still catches two clicks racing past this check.
  if (await ModelVersion.findOne({ where: { status: "training" } })) {
    throw new HttpError(409, "A model is already training.");
  }
  let model;
  try {
    model = await sequelize.transaction(async (transaction) =>
      ModelVersion.create(
        { version: await nextVersion(transaction), status: "training", progress: 0, message: "starting" },
        { transaction },
      ),
    );
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw new HttpError(409, "A model is already training.");
    throw err;
  }

  try {
    await ml.train(model.id);
    await model.update({ message: "queued on the ML service" });
  } catch (err) {
    if (err.status === 503) {
      // Keep the row: the laptop can pick it up with `python -m app.cli run-job <id>` (architecture.md §4.2).
      await model.update({ message: `ML service unreachable; run: python -m app.cli run-job ${model.id}` });
    } else {
      await model.update({ status: "failed", error: err.message, message: "could not start training" });
      throw err;
    }
  }
  res.status(202).json(model);
};

// POST /api/models/:id/deploy  (deploying an older version is a rollback)
const deploy = async (req, res) => {
  const model = await findModel(req.params.id);
  if (!["trained", "deployed"].includes(model.status)) {
    throw new HttpError(400, `Only a trained model can be deployed (this one is ${model.status}).`);
  }
  await sequelize.transaction(async (transaction) => {
    await ModelVersion.update({ status: "trained" }, { where: { status: "deployed" }, transaction });
    await model.update({ status: "deployed", deployed_at: new Date() }, { transaction });
  });
  res.json(model);
};

// DELETE /api/models/:id  (also how a stuck "training" row is cleared)
const remove = async (req, res) => {
  const model = await findModel(req.params.id);
  if (model.status === "deployed") throw new HttpError(400, "Deploy another version before deleting the live one.");
  await model.destroy();
  res.status(204).end();
};

module.exports = { latest, file, list, get, train, deploy, remove };
