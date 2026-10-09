// Every route in one place (docs/architecture.md §5). Three audiences, three guards:
//   public   — the Android app (no auth; frozen by CONTRACT.md)
//   auth     — the admin panel (JWT)
//   apiKey   — the ML service (X-API-Key)
const express = require("express");
const multer = require("multer");
const rateLimit = require("express-rate-limit");
const auth = require("../middleware/auth.js");
const apiKey = require("../middleware/apiKey.js");
const { wrap } = require("../middleware/errors.js");
const authC = require("../controllers/authController.js");
const signC = require("../controllers/signController.js");
const uploadC = require("../controllers/uploadController.js");
const modelC = require("../controllers/modelController.js");
const mlC = require("../controllers/mlController.js");

const clipUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024, files: 1 } });
const modelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 7 } });

// Only failed logins count, per IP, so a correct login never spends the budget.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many failed login attempts. Try again in 15 minutes." },
});

const router = express.Router();

// ── Public: Android app ──────────────────────────────────────
router.get("/health", (req, res) => res.json({ ok: true }));
router.get("/api/model/latest", wrap(modelC.latest));
router.get("/models/v:version/:name", wrap(modelC.file));

// ── Admin panel: auth ────────────────────────────────────────
router.post("/api/auth/login", loginLimiter, wrap(authC.login));
router.get("/api/auth/me", auth, wrap(authC.me));

// ── Admin panel: signs, uploads, samples ─────────────────────
router.get("/api/signs", auth, wrap(signC.list));
router.post("/api/signs", auth, wrap(signC.create));
router.patch("/api/signs/:id", auth, wrap(signC.update));
router.delete("/api/signs/:id", auth, wrap(signC.remove));
router.post("/api/signs/:id/uploads", auth, clipUpload.single("file"), wrap(signC.addUpload));
router.get("/api/signs/:id/uploads", auth, wrap(signC.listUploads));
router.get("/api/signs/:id/samples", auth, wrap(signC.listSamples));
router.delete("/api/uploads/:id", auth, wrap(uploadC.remove));

// ── Admin panel: models ──────────────────────────────────────
router.get("/api/models", auth, wrap(modelC.list));
router.post("/api/models/train", auth, wrap(modelC.train));
router.get("/api/models/:id", auth, wrap(modelC.get));
router.post("/api/models/:id/deploy", auth, wrap(modelC.deploy));
router.delete("/api/models/:id", auth, wrap(modelC.remove));

// ── ML service callbacks ─────────────────────────────────────
router.get("/api/ml/dataset", apiKey, wrap(mlC.dataset));
router.post("/api/ml/models/:id/progress", apiKey, wrap(mlC.progress));
router.post("/api/ml/models/:id/result", apiKey, modelUpload.any(), wrap(mlC.result));
router.post("/api/ml/models/:id/fail", apiKey, wrap(mlC.fail));

module.exports = router;
