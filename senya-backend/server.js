// Boot: env -> database -> migrations -> admin account -> sweep stuck training rows -> listen.
require("dotenv").config();

const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "ADMIN_USERNAME", "ADMIN_PASSWORD", "ML_API_KEY"];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(", ")} (copy .env.example to .env)`);
  process.exit(1);
}

const { sequelize, migrate } = require("./src/config/db.js");
const { ModelVersion } = require("./src/models/index.js");
const { seedAdmin } = require("./src/controllers/authController.js");
const { createApp } = require("./src/app.js");
const { Op } = require("sequelize");

// A training run never takes this long; a row still "training" after it was orphaned (laptop off, crash).
const STALE_TRAINING_MS = 2 * 60 * 60 * 1000;

async function main() {
  await sequelize.authenticate();
  await migrate();
  await seedAdmin();
  const [stale] = await ModelVersion.update(
    { status: "failed", error: "training never finished (ML service stopped?)", message: "training failed" },
    { where: { status: "training", created_at: { [Op.lt]: new Date(Date.now() - STALE_TRAINING_MS) } } },
  );
  if (stale) console.log(`Marked ${stale} stuck training run(s) as failed`);

  const port = Number(process.env.PORT) || 8000;
  createApp().listen(port, "0.0.0.0", () => console.log(`Senya backend on :${port}`));
}

main().catch((err) => {
  console.error("Startup failed:", err.message);
  process.exit(1);
});
