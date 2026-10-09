const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const routes = require("./routes/index.js");
const { errorHandler } = require("./middleware/errors.js");

// In production the backend also serves the built admin panel, so both share one origin (no CORS needed).
const ADMIN_DIST = path.join(__dirname, "..", "..", "senya-admin", "dist");

function createApp({ adminDist = ADMIN_DIST } = {}) {
  const app = express();
  app.set("trust proxy", 1); // Render sits in front: rate limiting must see the real client IP

  const allowed = (process.env.ALLOWED_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  // Requests without an Origin (the phone, the ML service, curl) are always allowed.
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)) }));
  app.use(express.json({ limit: "1mb" }));

  app.use(routes);
  app.use(["/api", "/models"], (req, res) => res.status(404).json({ message: "not found" }));

  if (adminDist && fs.existsSync(adminDist)) {
    app.use(express.static(adminDist));
    app.get("*", (req, res) => res.sendFile(path.join(adminDist, "index.html")));
  }

  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
