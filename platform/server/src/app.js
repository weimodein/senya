// Senya platform API. Endpoint shapes are specified in docs/architecture.md §4; keep both in sync.
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

const FLOATS = 63;
const MODEL_FILES = ['model.tflite', 'labels.json', 'golden.json',
  'motion.tflite', 'motion_labels.json', 'motion_config.json', 'motion_golden.json'];
const MOTION_FILES = MODEL_FILES.slice(3);
const MIN_STATIC = 30, MIN_MOTION = 20, MIN_NONE = 40;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const isLandmarks = (a) => Array.isArray(a) && a.length === FLOATS && a.every((v) => typeof v === 'number' && Number.isFinite(v));
const j = (v) => JSON.stringify(v);
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApp(db, { adminToken, webDir } = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '60mb' }));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

  const admin = (req, res, next) => {
    const given = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const ok = adminToken && given.length === adminToken.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(adminToken));
    return ok ? next() : res.status(401).json({ error: 'unauthorized' });
  };

  // ------------------------------------------------------------------ public (used by the Android app)
  app.get('/health', (req, res) => res.json({ ok: true }));

  app.get('/api/model/latest', wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT m.version, m.motion_labels IS NOT NULL AS has_motion,
              (SELECT sha256 FROM model_files f WHERE f.version = m.version AND f.name = 'model.tflite') AS sha,
              (SELECT sha256 FROM model_files f WHERE f.version = m.version AND f.name = 'motion.tflite') AS motion_sha
         FROM models m WHERE m.is_current`);
    if (!rows.length) return res.status(404).json({ error: 'no model published' });
    const v = rows[0].version, base = `/models/v${v}`;
    res.json({
      version: v,
      model_url: `${base}/model.tflite`, labels_url: `${base}/labels.json`, sha256: rows[0].sha,
      motion: rows[0].has_motion && rows[0].motion_sha
        ? { model_url: `${base}/motion.tflite`, labels_url: `${base}/motion_labels.json`,
            config_url: `${base}/motion_config.json`, sha256: rows[0].motion_sha }
        : null,
    });
  }));

  app.get('/models/v:version/:name', wrap(async (req, res) => {
    const { rows } = await db.query('SELECT content FROM model_files WHERE version = $1 AND name = $2',
      [Number(req.params.version), req.params.name]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    res.type(req.params.name.endsWith('.json') ? 'application/json' : 'application/octet-stream');
    res.send(Buffer.from(rows[0].content));
  }));

  // ------------------------------------------------------------------ signs
  app.get('/api/signs', admin, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT s.id, s.label, s.kind, s.start_shapes,
              (SELECT count(*) FROM samples x WHERE x.sign_id = s.id)::int +
              (SELECT count(*) FROM sequences q WHERE q.sign_id = s.id)::int AS sample_count,
              (SELECT count(*) FROM uploads u WHERE u.sign_id = s.id)::int AS upload_count
         FROM signs s ORDER BY s.label`);
    res.json(rows);
  }));

  app.post('/api/signs', admin, wrap(async (req, res) => {
    const { label, kind, start_shapes = null } = req.body || {};
    if (typeof label !== 'string' || !label.trim()) throw bad('label is required');
    if (!['static', 'motion'].includes(kind)) throw bad("kind must be 'static' or 'motion'");
    if (start_shapes !== null && !(Array.isArray(start_shapes) && start_shapes.every((s) => typeof s === 'string'))) {
      throw bad('start_shapes must be an array of labels');
    }
    const dup = await db.query('SELECT 1 FROM signs WHERE label = $1', [label.trim()]);
    if (dup.rows.length) throw new HttpError(409, 'label already exists');
    const { rows } = await db.query(
      'INSERT INTO signs (label, kind, start_shapes) VALUES ($1, $2, $3::jsonb) RETURNING *',
      [label.trim(), kind, start_shapes === null ? null : j(start_shapes)]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/signs/:id', admin, wrap(async (req, res) => {
    const { start_shapes } = req.body || {};
    if (!(Array.isArray(start_shapes) && start_shapes.every((s) => typeof s === 'string'))) throw bad('start_shapes must be an array');
    const { rows } = await db.query(
      "UPDATE signs SET start_shapes = $2::jsonb WHERE id = $1 AND kind = 'motion' RETURNING *",
      [Number(req.params.id), j(start_shapes)]);
    if (!rows.length) throw new HttpError(404, 'motion sign not found');
    res.json(rows[0]);
  }));

  app.delete('/api/signs/:id', admin, wrap(async (req, res) => {
    const { rows } = await db.query('SELECT label FROM signs WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw new HttpError(404, 'not found');
    if (rows[0].label === '_none') throw bad('_none cannot be deleted');
    await db.query('DELETE FROM signs WHERE id = $1', [Number(req.params.id)]);
    res.status(204).end();
  }));

  // ------------------------------------------------------------------ uploads (landmarks extracted in the browser)
  app.post('/api/signs/:id/uploads', admin, wrap(async (req, res) => {
    const signId = Number(req.params.id);
    const sign = (await db.query('SELECT id, kind FROM signs WHERE id = $1', [signId])).rows[0];
    if (!sign) throw new HttpError(404, 'sign not found');
    const { filename, no_hand_frames = 0, samples, sequences } = req.body || {};
    if (typeof filename !== 'string' || !filename) throw bad('filename is required');

    if (sign.kind === 'static') {
      if (sequences !== undefined) throw bad('static signs take samples, not sequences');
      if (!Array.isArray(samples) || !samples.length) throw bad('samples must be a non-empty array');
      if (samples.length > 5000) throw bad('at most 5000 samples per request');
      samples.forEach((s, i) => { if (!isLandmarks(s?.landmarks)) throw bad(`samples[${i}].landmarks must be ${FLOATS} finite numbers`); });
    } else {
      if (samples !== undefined) throw bad('motion signs take sequences, not samples');
      if (!Array.isArray(sequences) || !sequences.length) throw bad('sequences must be a non-empty array');
      if (sequences.length > 500) throw bad('at most 500 sequences per request');
      sequences.forEach((q, i) => {
        const f = q?.frames;
        if (!Array.isArray(f) || f.length < 2) throw bad(`sequences[${i}].frames needs at least 2 frames`);
        f.forEach((fr, k) => {
          if (!Number.isFinite(fr?.t_ms)) throw bad(`sequences[${i}].frames[${k}].t_ms must be a number`);
          if (fr.landmarks !== null && !isLandmarks(fr.landmarks)) throw bad(`sequences[${i}].frames[${k}].landmarks must be null or ${FLOATS} finite numbers`);
        });
        if (!f.some((fr) => fr.landmarks !== null)) throw bad(`sequences[${i}] has no frame with a hand`);
      });
    }

    const out = await db.tx(async (q) => {
      const up = (await q(
        'INSERT INTO uploads (sign_id, filename, no_hand_frames) VALUES ($1, $2, $3) RETURNING id',
        [signId, filename, Number(no_hand_frames) || 0])).rows[0];
      if (sign.kind === 'static') {
        for (const s of samples) {
          await q('INSERT INTO samples (sign_id, upload_id, landmarks, handedness, frame_index, thumb) VALUES ($1,$2,$3::jsonb,$4,$5,$6)',
            [signId, up.id, j(s.landmarks), s.handedness ?? null, s.frame_index ?? null, s.thumb ?? null]);
        }
        await q('UPDATE uploads SET samples_added = $2 WHERE id = $1', [up.id, samples.length]);
        return { upload_id: up.id, samples_added: samples.length, segments_found: 0, no_hand_frames: Number(no_hand_frames) || 0 };
      }
      for (const s of sequences) {
        const dur = s.duration_ms ?? Math.round(s.frames[s.frames.length - 1].t_ms - s.frames[0].t_ms);
        await q('INSERT INTO sequences (sign_id, upload_id, frames, duration_ms, handedness, thumb) VALUES ($1,$2,$3::jsonb,$4,$5,$6)',
          [signId, up.id, j(s.frames), Math.round(dur), s.handedness ?? null, s.thumb ?? null]);
      }
      await q('UPDATE uploads SET segments_found = $2 WHERE id = $1', [up.id, sequences.length]);
      return { upload_id: up.id, samples_added: 0, segments_found: sequences.length, no_hand_frames: Number(no_hand_frames) || 0 };
    });
    res.status(201).json(out);
  }));

  app.get('/api/signs/:id/uploads', admin, wrap(async (req, res) => {
    const { rows } = await db.query(
      'SELECT id, filename, samples_added, segments_found, no_hand_frames, created_at FROM uploads WHERE sign_id = $1 ORDER BY id DESC',
      [Number(req.params.id)]);
    res.json(rows);
  }));

  app.delete('/api/uploads/:id', admin, wrap(async (req, res) => {
    await db.query('DELETE FROM uploads WHERE id = $1', [Number(req.params.id)]);
    res.status(204).end();
  }));

  app.get('/api/signs/:id/items', admin, wrap(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    const { rows } = await db.query(
      `SELECT id, upload_id, thumb FROM (
         SELECT id, upload_id, thumb FROM samples WHERE sign_id = $1
         UNION ALL SELECT id, upload_id, thumb FROM sequences WHERE sign_id = $1) t
       ORDER BY id DESC LIMIT $2`, [Number(req.params.id), limit]);
    res.json(rows);
  }));

  // ------------------------------------------------------------------ training queue
  app.post('/api/train', admin, wrap(async (req, res) => {
    const counts = (await db.query(
      `SELECT s.label, s.kind,
              (SELECT count(*) FROM samples x WHERE x.sign_id = s.id)::int AS n_samples,
              (SELECT count(*) FROM sequences q WHERE q.sign_id = s.id)::int AS n_seq,
              (SELECT count(DISTINCT upload_id) FROM sequences q WHERE q.sign_id = s.id)::int AS n_up
         FROM signs s`)).rows;
    const staticReady = counts.filter((c) => c.kind === 'static' && c.n_samples >= MIN_STATIC);
    if (staticReady.length < 2) {
      throw bad(`need at least 2 static signs with ${MIN_STATIC}+ samples (have ${staticReady.length})`);
    }
    try {
      const { rows } = await db.query("INSERT INTO train_jobs (status, message) VALUES ('queued', 'waiting for the trainer') RETURNING id");
      res.status(202).json({ job_id: rows[0].id });
    } catch (e) {
      if (String(e.message).includes('train_jobs_one_active') || e.code === '23505') throw new HttpError(409, 'a training job is already queued or running');
      throw e;
    }
  }));

  app.get('/api/train/status', admin, wrap(async (req, res) => {
    const { rows } = await db.query(
      'SELECT id, status, progress, message, error, model_version, created_at FROM train_jobs ORDER BY id DESC LIMIT 1');
    res.json(rows[0] || null);
  }));

  app.get('/api/train/jobs/next', admin, wrap(async (req, res) => {
    const job = await db.tx(async (q) => {
      const next = (await q("SELECT id FROM train_jobs WHERE status = 'queued' ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!next) return null;
      await q("UPDATE train_jobs SET status = 'running', message = 'trainer started', updated_at = now() WHERE id = $1", [next.id]);
      return next;
    });
    if (!job) return res.status(204).end();
    res.json({ id: job.id });
  }));

  app.post('/api/train/jobs/:id/progress', admin, wrap(async (req, res) => {
    const { progress = 0, message = '' } = req.body || {};
    await db.query('UPDATE train_jobs SET progress = $2, message = $3, updated_at = now() WHERE id = $1',
      [Number(req.params.id), Number(progress) || 0, String(message).slice(0, 500)]);
    res.status(204).end();
  }));

  app.post('/api/train/jobs/:id/fail', admin, wrap(async (req, res) => {
    await db.query("UPDATE train_jobs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1",
      [Number(req.params.id), String((req.body || {}).error || 'unknown error').slice(0, 2000)]);
    res.status(204).end();
  }));

  app.get('/api/export', admin, wrap(async (req, res) => {
    const signs = (await db.query('SELECT id, label, kind, start_shapes FROM signs ORDER BY id')).rows;
    const samples = (await db.query('SELECT sign_id, upload_id, landmarks FROM samples ORDER BY id')).rows;
    const seqs = (await db.query('SELECT sign_id, upload_id, frames FROM sequences ORDER BY id')).rows;
    const out = signs.map((s) => {
      const uploads = new Map();
      const slot = (uid) => { if (!uploads.has(uid)) uploads.set(uid, { id: uid, samples: [], sequences: [] }); return uploads.get(uid); };
      for (const r of samples) if (r.sign_id === s.id) slot(r.upload_id).samples.push(r.landmarks);
      for (const r of seqs) if (r.sign_id === s.id) slot(r.upload_id).sequences.push({ frames: r.frames });
      const list = [...uploads.values()].map((u) => (s.kind === 'static' ? { id: u.id, samples: u.samples } : { id: u.id, sequences: u.sequences }));
      return { label: s.label, kind: s.kind, start_shapes: s.start_shapes, uploads: list };
    });
    res.json({ signs: out });
  }));

  // ------------------------------------------------------------------ models
  app.post('/api/models', admin, upload.any(), wrap(async (req, res) => {
    const files = Object.fromEntries((req.files || []).map((f) => [f.fieldname, f.buffer]));
    for (const name of Object.keys(files)) if (!MODEL_FILES.includes(name)) throw bad(`unexpected file ${name}`);
    for (const name of ['model.tflite', 'labels.json', 'golden.json']) if (!files[name]) throw bad(`missing ${name}`);
    const motionPresent = MOTION_FILES.filter((n) => files[n]).length;
    if (motionPresent !== 0 && motionPresent !== MOTION_FILES.length) throw bad('motion files must be all four or none');
    let meta;
    try { meta = JSON.parse(req.body.meta || '{}'); } catch { throw bad('meta is not valid JSON'); }
    if (!Array.isArray(meta.labels)) throw bad('meta.labels is required');
    if (motionPresent && !Array.isArray(meta.motion_labels)) throw bad('meta.motion_labels is required with motion files');

    const out = await db.tx(async (q) => {
      const m = (await q(
        `INSERT INTO models (labels, val_accuracy, report, motion_labels, motion_val_accuracy, motion_report)
         VALUES ($1::jsonb,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb) RETURNING version`,
        [j(meta.labels), meta.val_accuracy ?? null, j(meta.report ?? null),
          motionPresent ? j(meta.motion_labels) : null, motionPresent ? meta.motion_val_accuracy ?? null : null,
          motionPresent ? j(meta.motion_report ?? null) : null])).rows[0];
      for (const [name, content] of Object.entries(files)) {
        await q('INSERT INTO model_files (version, name, content, sha256) VALUES ($1,$2,$3,$4)',
          [m.version, name, content, crypto.createHash('sha256').update(content).digest('hex')]);
      }
      if (req.body.job_id) {
        await q("UPDATE train_jobs SET status = 'done', progress = 1, model_version = $2, message = 'done', updated_at = now() WHERE id = $1",
          [Number(req.body.job_id), m.version]);
      }
      return m;
    });
    res.status(201).json({ version: out.version });
  }));

  app.get('/api/models', admin, wrap(async (req, res) => {
    const { rows } = await db.query(
      `SELECT version, is_current, val_accuracy, motion_val_accuracy, labels, motion_labels,
              motion_labels IS NOT NULL AS has_motion, report, motion_report, created_at
         FROM models ORDER BY version DESC`);
    res.json(rows);
  }));

  app.post('/api/models/:version/publish', admin, wrap(async (req, res) => {
    const version = Number(req.params.version);
    const ok = await db.tx(async (q) => {
      const exists = (await q('SELECT 1 FROM models WHERE version = $1', [version])).rows.length;
      if (!exists) return false;
      await q('UPDATE models SET is_current = false WHERE is_current');
      await q('UPDATE models SET is_current = true WHERE version = $1', [version]);
      return true;
    });
    if (!ok) throw new HttpError(404, 'no such version');
    res.json({ version, is_current: true });
  }));

  // ------------------------------------------------------------------ web UI (built React app), if present
  if (webDir && existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(/^\/(?!api\/|models\/|health).*/, (req, res) => res.sendFile('index.html', { root: webDir }));
  }

  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request too large' });
    console.error(err);
    res.status(500).json({ error: 'internal error' });
  });
  return app;
}
