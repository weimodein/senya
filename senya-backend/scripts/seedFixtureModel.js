// npm run seed:v0 — stores the dummy v0 model from fixtures/mock_server/models/v0 as version 0 and deploys it if
// nothing is deployed yet. Lets the phone connect end to end before any real training (milestone M1).
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { sequelize, migrate } = require("../src/config/db.js");
const { ModelVersion } = require("../src/models/index.js");
const { saveTrained } = require("../src/services/modelStore.js");
const { MODEL_FILES } = require("../src/utils/contract.js");

const DIR = path.join(__dirname, "..", "..", "fixtures", "mock_server", "models", "v0");

async function main() {
  await migrate();
  if (await ModelVersion.findOne({ where: { version: 0 } })) {
    console.log("version 0 already exists; nothing to do");
    return;
  }
  const files = {};
  for (const name of MODEL_FILES) {
    const p = path.join(DIR, name);
    if (fs.existsSync(p)) files[name] = fs.readFileSync(p);
  }
  const json = (name) => (files[name] ? JSON.parse(files[name].toString("utf8")) : undefined);
  const model = await ModelVersion.create({ version: 0, status: "training", message: "seeding fixture" });
  await saveTrained(model, files, { labels: json("labels.json"), motion_labels: json("motion_labels.json") });
  await model.update({ message: "dummy fixture model (synthetic data)" });
  if (!(await ModelVersion.findOne({ where: { status: "deployed" } }))) {
    await model.update({ status: "deployed", deployed_at: new Date() });
  }
  console.log(`seeded version 0 (${Object.keys(files).length} files), status ${model.status}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());
