// Stores a trained version's files and metadata. Used by the ML result callback and the fixture seeder.
const crypto = require("crypto");
const { sequelize, ModelFile } = require("../models/index.js");
const { HttpError } = require("../middleware/errors.js");
const { MODEL_FILES, REQUIRED_FILES, MOTION_FILES } = require("../utils/contract.js");

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

/** Throws a 400 unless `files` is a complete contract file set and `meta` describes it. */
function validate(files, meta) {
  for (const name of Object.keys(files)) {
    if (!MODEL_FILES.includes(name)) throw new HttpError(400, `unexpected file ${name}`);
  }
  for (const name of REQUIRED_FILES) if (!files[name]) throw new HttpError(400, `missing ${name}`);
  const motion = MOTION_FILES.filter((n) => files[n]).length;
  if (motion !== 0 && motion !== MOTION_FILES.length) throw new HttpError(400, "motion files must be all four or none");
  if (!Array.isArray(meta?.labels)) throw new HttpError(400, "meta.labels is required");
  if (motion && !Array.isArray(meta.motion_labels)) throw new HttpError(400, "meta.motion_labels is required");
  return motion > 0;
}

/** Saves the files of model row `model` and marks it trained, in one transaction. */
async function saveTrained(model, files, meta) {
  const hasMotion = validate(files, meta);
  await sequelize.transaction(async (transaction) => {
    await ModelFile.destroy({ where: { model_id: model.id }, transaction });
    await ModelFile.bulkCreate(
      Object.entries(files).map(([name, content]) => ({ model_id: model.id, name, content, sha256: sha256(content) })),
      { transaction },
    );
    await model.update(
      {
        status: "trained",
        progress: 1,
        message: "ready to deploy",
        error: null,
        labels: meta.labels,
        motion_labels: hasMotion ? meta.motion_labels : null,
        val_accuracy: meta.val_accuracy ?? null,
        motion_val_accuracy: hasMotion ? meta.motion_val_accuracy ?? null : null,
        report: { static: meta.report ?? null, motion: hasMotion ? meta.motion_report ?? null : null },
        trained_at: new Date(),
      },
      { transaction },
    );
  });
}

/** Next version number, from a sequence: never reused, even after the newest version is deleted (002_*.sql). */
async function nextVersion(transaction) {
  const [[row]] = await sequelize.query("SELECT nextval('model_version_seq')::int AS v", { transaction });
  return row.v;
}

module.exports = { saveTrained, nextVersion, sha256 };
