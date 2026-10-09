import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

const TOKEN = 'test-token';
let db, server, base;

before(async () => {
  db = await openDb({ url: '', dataDir: undefined }); // in-memory PGlite
  server = createApp(db, { adminToken: TOKEN }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { server.close(); await db.close(); });

const call = (method, path, body, token = TOKEN) =>
  fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const lm = (x = 0.5) => Array.from({ length: 63 }, (_, i) => x + i * 0.001);
const samples = (n) => Array.from({ length: n }, () => ({ landmarks: lm(Math.random()), handedness: 'Right' }));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function modelForm({ motion = false, jobId } = {}) {
  const f = new FormData();
  if (jobId) f.append('job_id', String(jobId));
  f.append('meta', JSON.stringify({ labels: ['A', 'B'], val_accuracy: 0.95, report: { ok: 1 },
    ...(motion ? { motion_labels: ['_none', 'J'], motion_val_accuracy: 0.9, motion_report: {} } : {}) }));
  for (const name of ['model.tflite', 'labels.json', 'golden.json']) f.append(name, new Blob([`static-${name}`]), name);
  if (motion) for (const name of ['motion.tflite', 'motion_labels.json', 'motion_config.json', 'motion_golden.json']) f.append(name, new Blob([`motion-${name}`]), name);
  return f;
}
const post = (path, form) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: form });

test('health and public latest need no token; latest is 404 before any publish', async () => {
  assert.equal((await call('GET', '/health', null, null)).status, 200);
  assert.equal((await call('GET', '/api/model/latest', null, null)).status, 404);
});

test('admin endpoints reject a missing or wrong token', async () => {
  assert.equal((await call('GET', '/api/signs', null, null)).status, 401);
  assert.equal((await call('GET', '/api/signs', null, 'wrong')).status, 401);
  assert.equal((await call('POST', '/api/train', {}, 'x')).status, 401);
});

test('signs: _none exists, create, duplicate 409, bad input 400, _none cannot be deleted', async () => {
  const list = await (await call('GET', '/api/signs')).json();
  assert.ok(list.some((s) => s.label === '_none' && s.kind === 'motion'));
  const a = await call('POST', '/api/signs', { label: 'A', kind: 'static' });
  assert.equal(a.status, 201);
  assert.equal((await call('POST', '/api/signs', { label: 'A', kind: 'static' })).status, 409);
  assert.equal((await call('POST', '/api/signs', { label: 'X', kind: 'wiggle' })).status, 400);
  const none = list.find((s) => s.label === '_none');
  assert.equal((await call('DELETE', `/api/signs/${none.id}`)).status, 400);
});

test('uploads: validation, counts, delete cascades', async () => {
  const s = await (await call('POST', '/api/signs', { label: 'U', kind: 'static' })).json();
  const bad = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'x', samples: [{ landmarks: [1, 2, 3] }] });
  assert.equal(bad.status, 400);
  assert.match((await bad.json()).error, /63 finite/);
  const nan = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'x', samples: [{ landmarks: [...lm().slice(1), null] }] });
  assert.equal(nan.status, 400);
  const wrongKind = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'x', sequences: [] });
  assert.equal(wrongKind.status, 400);
  const ok = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'u.mp4', no_hand_frames: 3, samples: samples(5) });
  assert.equal(ok.status, 201);
  const body = await ok.json();
  assert.equal(body.samples_added, 5);
  assert.equal((await (await call('GET', '/api/signs')).json()).find((x) => x.id === s.id).sample_count, 5);
  assert.equal((await call('DELETE', `/api/uploads/${body.upload_id}`)).status, 204);
  assert.equal((await (await call('GET', '/api/signs')).json()).find((x) => x.id === s.id).sample_count, 0);
});

test('motion uploads accept null frames and reject sequences without a hand', async () => {
  const s = await (await call('POST', '/api/signs', { label: 'J', kind: 'motion', start_shapes: ['I'] })).json();
  const frames = [{ t_ms: 0, landmarks: lm() }, { t_ms: 33, landmarks: null }, { t_ms: 66, landmarks: lm(0.6) }];
  const ok = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'j.mp4', sequences: [{ frames }] });
  assert.equal(ok.status, 201);
  assert.equal((await ok.json()).segments_found, 1);
  const noHand = await call('POST', `/api/signs/${s.id}/uploads`, { filename: 'j.mp4', sequences: [{ frames: frames.map((f) => ({ ...f, landmarks: null })) }] });
  assert.equal(noHand.status, 400);
  const patched = await call('PATCH', `/api/signs/${s.id}`, { start_shapes: ['I', 'L'] });
  assert.deepEqual((await patched.json()).start_shapes, ['I', 'L']);
});

test('train: refuses without data, queues, 409 while active, trainer claims it, export has the documented shape', async () => {
  assert.equal((await call('POST', '/api/train', {})).status, 400);
  for (const label of ['T1', 'T2']) {
    const s = await (await call('POST', '/api/signs', { label, kind: 'static' })).json();
    for (let i = 0; i < 2; i++) await call('POST', `/api/signs/${s.id}/uploads`, { filename: `${label}-${i}`, samples: samples(20) });
  }
  const queued = await call('POST', '/api/train', {});
  assert.equal(queued.status, 202);
  const { job_id } = await queued.json();
  assert.equal((await call('POST', '/api/train', {})).status, 409);

  const claimed = await call('GET', '/api/train/jobs/next');
  assert.equal(claimed.status, 200);
  assert.equal((await claimed.json()).id, job_id);
  assert.equal((await call('GET', '/api/train/jobs/next')).status, 204);
  assert.equal((await call('POST', `/api/train/jobs/${job_id}/progress`, { progress: 0.4, message: 'epoch 3/10' })).status, 204);
  const status = await (await call('GET', '/api/train/status')).json();
  assert.equal(status.status, 'running');
  assert.equal(status.progress, 0.4);

  const exp = await (await call('GET', '/api/export')).json();
  const t1 = exp.signs.find((s) => s.label === 'T1');
  assert.equal(t1.kind, 'static');
  assert.equal(t1.uploads.length, 2);
  assert.equal(t1.uploads[0].samples[0].length, 63);
  const j = exp.signs.find((s) => s.label === 'J');
  assert.equal(j.uploads[0].sequences[0].frames[1].landmarks, null);

  assert.equal((await call('POST', `/api/train/jobs/${job_id}/fail`, { error: 'boom' })).status, 204);
  const failed = await (await call('GET', '/api/train/status')).json();
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'boom');
  assert.equal((await call('POST', '/api/train', {})).status, 202); // a new job is allowed after a failure
});

test('models: upload static, reject bad uploads, publish, latest + files + sha256, motion, rollback', async () => {
  assert.equal((await post('/api/models', new FormData())).status, 400);
  const half = modelForm({ motion: true });
  half.delete('motion_golden.json');
  assert.equal((await post('/api/models', half)).status, 400);
  const weird = modelForm(); weird.append('evil.sh', new Blob(['x']), 'evil.sh');
  assert.equal((await post('/api/models', weird)).status, 400);

  const jobs = await (await call('GET', '/api/train/status')).json();
  const v1 = await (await post('/api/models', modelForm({ jobId: jobs.id }))).json();
  assert.equal(v1.version, 1);
  assert.equal((await call('GET', '/api/train/status').then((r) => r.json())).status, 'done');
  assert.equal((await call('GET', '/api/model/latest', null, null)).status, 404); // uploaded but not published yet

  assert.equal((await call('POST', '/api/models/1/publish')).status, 200);
  const latest = await (await call('GET', '/api/model/latest', null, null)).json();
  assert.equal(latest.version, 1);
  assert.equal(latest.motion, null);
  assert.equal(latest.model_url, '/models/v1/model.tflite');
  assert.equal(latest.sha256, sha('static-model.tflite'));
  const file = await fetch(base + latest.model_url); // public, no token
  assert.equal(file.status, 200);
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'static-model.tflite');
  assert.equal((await fetch(base + '/models/v1/golden.json')).headers.get('content-type').includes('json'), true);
  assert.equal((await fetch(base + '/models/v1/nope.tflite')).status, 404);

  const v2 = await (await post('/api/models', modelForm({ motion: true }))).json();
  assert.equal(v2.version, 2);
  await call('POST', '/api/models/2/publish');
  const latest2 = await (await call('GET', '/api/model/latest', null, null)).json();
  assert.equal(latest2.version, 2);
  assert.equal(latest2.motion.config_url, '/models/v2/motion_config.json');
  assert.equal(latest2.motion.sha256, sha('motion-motion.tflite'));

  const list = await (await call('GET', '/api/models')).json();
  assert.deepEqual(list.map((m) => [m.version, m.is_current, m.has_motion]), [[2, true, true], [1, false, false]]);

  await call('POST', '/api/models/1/publish'); // rollback
  assert.equal((await (await call('GET', '/api/model/latest', null, null)).json()).version, 1);
  assert.equal((await call('POST', '/api/models/99/publish')).status, 404);
});
