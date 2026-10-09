// End-to-end API test (docs/architecture.md §4–5) against a real Postgres (your Supabase DATABASE_URL from .env),
// isolated in its own schema `senya_test`, which is dropped and rebuilt on every run. A stub plays the ML service.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const SKIP = !process.env.DATABASE_URL && "DATABASE_URL not set (copy .env.example to .env)";
process.env.DB_SCHEMA = "senya_test";
Object.assign(process.env, {
  JWT_SECRET: "test-secret",
  ADMIN_USERNAME: "tester",
  ADMIN_PASSWORD: "correct horse",
  ML_API_KEY: "test-ml-key",
});

const FIXTURE = path.join(__dirname, "..", "..", "fixtures", "mock_server", "models", "v0");
const hand = (cx) => Array.from({ length: 63 }, (_, k) => (k % 3 === 0 ? cx + 0.01 * (k / 3) : k % 3 === 1 ? 0.5 : 0));

// ── Stub ML service: records calls, answers like senya-ml ──────────────────
const mlCalls = [];
let mlDown = false;
function startStubMl() {
  const app = express();
  app.use((req, res, next) => {
    if (req.headers["x-api-key"] !== "test-ml-key") return res.status(401).json({ detail: "Unauthorized" });
    next();
  });
  app.post("/extract", require("multer")().single("file"), (req, res) => {
    mlCalls.push({ path: "/extract", kind: req.body.kind, filename: req.file.originalname });
    if (req.file.originalname.startsWith("empty")) return res.status(422).json({ detail: "no hand found in this clip" });
    if (req.body.kind === "static") {
      return res.json({ kind: "static", no_hand_frames: 2,
        samples: Array.from({ length: 35 }, (_, i) => ({ landmarks: hand(0.3 + i * 0.001), handedness: "Right", frame_index: i, thumb: null })) });
    }
    const frames = Array.from({ length: 30 }, (_, n) => ({ t_ms: 33 * n, landmarks: n === 4 ? null : hand(0.3 + 0.02 * n) }));
    res.json({ kind: "motion", no_hand_frames: 1, sequences: [{ duration_ms: 957, handedness: "Right", thumb: null, frames }] });
  });
  app.post("/train", express.json(), (req, res) => {
    mlCalls.push({ path: "/train", model_id: req.body.model_id });
    res.status(202).json({ status: "started" });
  });
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

let server, mlServer, base, sequelize, token;
const call = async (method, url, { body, form, auth = true, key } = {}) => {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (key) headers["X-API-Key"] = key;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + url, { method, headers, body: payload });
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
};
const fileForm = (name) => {
  const f = new FormData();
  f.append("file", new Blob([Buffer.from("fake video bytes")]), name);
  return f;
};

before(async () => {
  if (SKIP) return;
  mlServer = await startStubMl();
  process.env.ML_SERVICE_URL = `http://127.0.0.1:${mlServer.address().port}`;
  ({ sequelize } = require("../src/config/db.js"));
  await sequelize.query("DROP SCHEMA IF EXISTS senya_test CASCADE");
  await sequelize.close();
  // Reconnect so every pooled connection is created after the drop (afterConnect recreates the schema).
  delete require.cache[require.resolve("../src/config/db.js")];
  delete require.cache[require.resolve("../src/models/index.js")];
  const db = require("../src/config/db.js");
  sequelize = db.sequelize;
  await db.migrate();
  await require("../src/controllers/authController.js").seedAdmin();
  server = require("../src/app.js").createApp({ adminDist: null }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  mlServer?.close();
  await sequelize?.close();
});

test("public endpoints: health, and 404 before anything is deployed", { skip: SKIP }, async () => {
  assert.deepEqual((await call("GET", "/health")).data, { ok: true });
  assert.equal((await call("GET", "/api/model/latest")).status, 404);
});

test("login: wrong password 401, right one returns a working JWT", { skip: SKIP }, async () => {
  assert.equal((await call("GET", "/api/signs")).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { body: { username: "tester", password: "nope" } })).status, 401);
  const ok = await call("POST", "/api/auth/login", { body: { username: "tester", password: "correct horse" } });
  assert.equal(ok.status, 200);
  token = ok.data.token;
  assert.equal((await call("GET", "/api/auth/me")).data.username, "tester");
});

test("ML routes need the API key", { skip: SKIP }, async () => {
  assert.equal((await call("GET", "/api/ml/dataset")).status, 401);
  assert.equal((await call("GET", "/api/ml/dataset", { key: "wrong-key-same-len" })).status, 401);
});

test("signs CRUD, _none exists and is protected", { skip: SKIP }, async () => {
  for (const [label, kind, start_shapes] of [["A", "static"], ["B", "static"], ["J", "motion", ["I"]]]) {
    assert.equal((await call("POST", "/api/signs", { body: { label, kind, start_shapes } })).status, 201);
  }
  assert.equal((await call("POST", "/api/signs", { body: { label: "A", kind: "static" } })).status, 409);
  assert.equal((await call("POST", "/api/signs", { body: { label: "Q", kind: "wiggle" } })).status, 400);
  const signs = (await call("GET", "/api/signs")).data;
  const none = signs.find((s) => s.label === "_none");
  assert.ok(none);
  assert.equal((await call("DELETE", `/api/signs/${none.id}`)).status, 400);
  const j = signs.find((s) => s.label === "J");
  assert.deepEqual((await call("PATCH", `/api/signs/${j.id}`, { body: { start_shapes: ["I", "L"] } })).data.start_shapes, ["I", "L"]);
});

test("training is refused until there is enough data", { skip: SKIP }, async () => {
  assert.equal((await call("POST", "/api/models/train")).status, 400);
});

test("uploads go through the ML service and land as samples", { skip: SKIP }, async () => {
  const signs = Object.fromEntries((await call("GET", "/api/signs")).data.map((s) => [s.label, s]));
  const a = await call("POST", `/api/signs/${signs.A.id}/uploads`, { form: fileForm("A_1.mp4") });
  assert.equal(a.status, 201);
  assert.equal(a.data.samples_added, 35);
  assert.deepEqual(mlCalls.at(-1), { path: "/extract", kind: "static", filename: "A_1.mp4" });
  assert.equal((await call("POST", `/api/signs/${signs.B.id}/uploads`, { form: fileForm("B_1.mp4") })).status, 201);
  const j = await call("POST", `/api/signs/${signs.J.id}/uploads`, { form: fileForm("J_1.mp4") });
  assert.equal(j.data.segments_found, 1);

  const empty = await call("POST", `/api/signs/${signs.A.id}/uploads`, { form: fileForm("empty.mp4") });
  assert.equal(empty.status, 422);
  assert.match(empty.data.message, /no hand/);
  assert.equal((await call("GET", `/api/signs/${signs.A.id}/uploads`)).data.length, 1);
  assert.equal((await call("GET", `/api/signs/${signs.A.id}/samples?limit=5`)).data.length, 5);
});

test("an unreachable ML service gives a clear 503 on upload", { skip: SKIP }, async () => {
  const saved = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = "http://127.0.0.1:1";
  try {
    const signs = (await call("GET", "/api/signs")).data;
    const r = await call("POST", `/api/signs/${signs.find((s) => s.label === "A").id}/uploads`, { form: fileForm("x.mp4") });
    assert.equal(r.status, 503);
  } finally {
    process.env.ML_SERVICE_URL = saved;
  }
});

test("the dataset the trainer downloads is grouped by sign and upload", { skip: SKIP }, async () => {
  const { data } = await call("GET", "/api/ml/dataset", { auth: false, key: "test-ml-key" });
  const by = Object.fromEntries(data.signs.map((s) => [s.label, s]));
  assert.equal(by.A.uploads.length, 1);
  assert.equal(by.A.uploads[0].samples.length, 35);
  assert.equal(by.A.uploads[0].samples[0].length, 63);
  assert.equal(by.J.uploads[0].sequences[0].frames.length, 30);
  assert.equal(by.J.uploads[0].sequences[0].frames[4].landmarks, null);
  assert.deepEqual(by.J.start_shapes, ["I", "L"]);
  assert.deepEqual(by._none.uploads, []);
});

test("train -> callbacks -> trained -> deploy -> the phone sees it", { skip: SKIP }, async () => {
  const started = await call("POST", "/api/models/train");
  assert.equal(started.status, 202);
  const id = started.data.id;
  assert.equal(started.data.version, 1);
  assert.deepEqual(mlCalls.at(-1), { path: "/train", model_id: id });
  assert.equal((await call("POST", "/api/models/train")).status, 409);

  const key = "test-ml-key";
  assert.equal((await call("POST", `/api/ml/models/${id}/progress`, { auth: false, key, body: { progress: 0.4, message: "epoch 12/40" } })).status, 204);
  assert.equal((await call("GET", `/api/models/${id}`)).data.message, "epoch 12/40");

  const files = Object.fromEntries(fs.readdirSync(FIXTURE).map((n) => [n, fs.readFileSync(path.join(FIXTURE, n))]));
  const form = new FormData();
  form.append("meta", JSON.stringify({
    labels: JSON.parse(files["labels.json"]), val_accuracy: 0.97, report: { ok: true },
    motion_labels: JSON.parse(files["motion_labels.json"]), motion_val_accuracy: 0.9, motion_report: {},
  }));
  for (const [name, content] of Object.entries(files)) form.append(name, new Blob([content]), name);
  assert.equal((await call("POST", `/api/ml/models/${id}/result`, { auth: false, key, form })).status, 204);

  const trained = (await call("GET", `/api/models/${id}`)).data;
  assert.equal(trained.status, "trained");
  assert.equal(trained.val_accuracy, 0.97);
  assert.equal((await call("GET", "/api/model/latest")).status, 404, "not live until deployed");

  assert.equal((await call("POST", `/api/models/${id}/deploy`)).status, 200);
  const latest = (await call("GET", "/api/model/latest", { auth: false })).data;
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  assert.equal(latest.version, 1);
  assert.equal(latest.model_url, "/models/v1/model.tflite");
  assert.equal(latest.sha256, sha(files["model.tflite"]));
  assert.equal(latest.motion.sha256, sha(files["motion.tflite"]));
  assert.equal(latest.motion.config_url, "/models/v1/motion_config.json");

  const blob = await call("GET", latest.model_url, { auth: false });
  assert.equal(sha(blob.data), latest.sha256);
  assert.deepEqual((await call("GET", "/models/v1/labels.json", { auth: false })).data, JSON.parse(files["labels.json"]));
  assert.equal((await call("GET", "/models/v9/model.tflite", { auth: false })).status, 404);
  assert.equal((await call("DELETE", `/api/models/${id}`)).status, 400, "the live model can't be deleted");
});

test("a failed run, rollback, and late callbacks are rejected", { skip: SKIP }, async () => {
  const second = (await call("POST", "/api/models/train")).data;
  assert.equal(second.version, 2);
  const key = "test-ml-key";
  assert.equal((await call("POST", `/api/ml/models/${second.id}/fail`, { auth: false, key, body: { error: "boom" } })).status, 204);
  const failed = (await call("GET", `/api/models/${second.id}`)).data;
  assert.equal(failed.status, "failed");
  assert.equal(failed.error, "boom");
  assert.equal((await call("POST", `/api/ml/models/${second.id}/progress`, { auth: false, key, body: { progress: 1 } })).status, 409);
  assert.equal((await call("POST", `/api/models/${second.id}/deploy`)).status, 400);
  assert.equal((await call("DELETE", `/api/models/${second.id}`)).status, 204);
  assert.equal((await call("GET", "/api/model/latest", { auth: false })).data.version, 1, "still the deployed one");
  const list = (await call("GET", "/api/models")).data;
  assert.deepEqual(list.map((m) => m.version), [1]);
});

test("training with the ML service down keeps the row for the CLI fallback", { skip: SKIP }, async () => {
  const saved = process.env.ML_SERVICE_URL;
  process.env.ML_SERVICE_URL = "http://127.0.0.1:1";
  try {
    const r = await call("POST", "/api/models/train");
    assert.equal(r.status, 202);
    assert.equal(r.data.version, 3, "version 2 was deleted, but its number must never be handed out again");
    const row = (await call("GET", `/api/models/${r.data.id}`)).data;
    assert.equal(row.status, "training");
    assert.match(row.message, new RegExp(`run-job ${r.data.id}`));
  } finally {
    process.env.ML_SERVICE_URL = saved;
  }
});
