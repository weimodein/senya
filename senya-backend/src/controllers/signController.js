const { QueryTypes } = require("sequelize");
const { sequelize, Sign, Upload, Sample } = require("../models/index.js");
const { HttpError, intParam } = require("../middleware/errors.js");
const { NONE_LABEL, extractionError } = require("../utils/contract.js");
const ml = require("../services/mlClient.js");

const isLabelList = (v) => Array.isArray(v) && v.every((s) => typeof s === "string" && s.trim());

async function findSign(id) {
  const sign = await Sign.findByPk(intParam(id));
  if (!sign) throw new HttpError(404, "sign not found");
  return sign;
}

// GET /api/signs
const list = async (req, res) => {
  const rows = await sequelize.query(
    `SELECT s.id, s.label, s.kind, s.start_shapes, s.created_at,
            (SELECT count(*) FROM samples x WHERE x.sign_id = s.id)::int AS sample_count,
            (SELECT count(*) FROM uploads u WHERE u.sign_id = s.id)::int AS upload_count
       FROM signs s ORDER BY s.kind, s.label`,
    { type: QueryTypes.SELECT },
  );
  res.json(rows);
};

// POST /api/signs {label, kind, start_shapes?}
const create = async (req, res) => {
  const { label, kind, start_shapes = null } = req.body || {};
  if (typeof label !== "string" || !label.trim()) throw new HttpError(400, "label is required");
  if (!["static", "motion"].includes(kind)) throw new HttpError(400, "kind must be 'static' or 'motion'");
  if (start_shapes !== null && !isLabelList(start_shapes)) {
    throw new HttpError(400, "start_shapes must be an array of labels");
  }
  if (await Sign.findOne({ where: { label: label.trim() } })) throw new HttpError(409, "label already exists");
  const sign = await Sign.create({ label: label.trim(), kind, start_shapes: kind === "motion" ? start_shapes : null });
  res.status(201).json(sign);
};

// PATCH /api/signs/:id {start_shapes}
const update = async (req, res) => {
  const sign = await findSign(req.params.id);
  const { start_shapes } = req.body || {};
  if (sign.kind !== "motion") throw new HttpError(400, "only motion signs have start_shapes");
  if (!isLabelList(start_shapes)) throw new HttpError(400, "start_shapes must be an array of labels");
  await sign.update({ start_shapes });
  res.json(sign);
};

// DELETE /api/signs/:id  (cascades to uploads and samples)
const remove = async (req, res) => {
  const sign = await findSign(req.params.id);
  if (sign.label === NONE_LABEL) throw new HttpError(400, `${NONE_LABEL} cannot be deleted`);
  await sign.destroy();
  res.status(204).end();
};

// POST /api/signs/:id/uploads  multipart `file` -> ML /extract -> one upload + its samples
const addUpload = async (req, res) => {
  const sign = await findSign(req.params.id);
  if (!req.file) throw new HttpError(400, "attach the clip or image as the `file` field");

  const result = await ml.extract(req.file.buffer, req.file.originalname, sign.kind);
  const problem = extractionError(sign.kind, result);
  if (problem) throw new HttpError(502, `ML service returned an unusable result: ${problem}`);

  const isStatic = sign.kind === "static";
  const items = isStatic ? result.samples : result.sequences;
  const upload = await sequelize.transaction(async (transaction) => {
    const up = await Upload.create(
      {
        sign_id: sign.id,
        filename: req.file.originalname,
        no_hand_frames: Number(result.no_hand_frames) || 0,
        samples_added: isStatic ? items.length : 0,
        segments_found: isStatic ? 0 : items.length,
      },
      { transaction },
    );
    await Sample.bulkCreate(
      items.map((it) => ({
        sign_id: sign.id,
        upload_id: up.id,
        kind: sign.kind,
        data: isStatic
          ? it.landmarks
          : {
              duration_ms: Math.round(it.duration_ms ?? it.frames[it.frames.length - 1].t_ms - it.frames[0].t_ms),
              frames: it.frames,
            },
        handedness: it.handedness ?? null,
        thumb: it.thumb ?? null,
      })),
      { transaction },
    );
    return up;
  });
  res.status(201).json(upload);
};

// GET /api/signs/:id/uploads
const listUploads = async (req, res) => {
  const sign = await findSign(req.params.id);
  res.json(await Upload.findAll({ where: { sign_id: sign.id }, order: [["id", "DESC"]] }));
};

// GET /api/signs/:id/samples?limit=60  -> thumbnails for the review grid
const listSamples = async (req, res) => {
  const sign = await findSign(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 60, 200);
  res.json(
    await Sample.findAll({
      where: { sign_id: sign.id },
      attributes: ["id", "upload_id", "thumb"],
      order: [["id", "DESC"]],
      limit,
    }),
  );
};

module.exports = { list, create, update, remove, addUpload, listUploads, listSamples };
