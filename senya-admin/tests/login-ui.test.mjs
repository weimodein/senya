import assert from "node:assert/strict";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const port = 4173;

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/login`);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Vite did not start in time");
}

test("login presents the accessible SENYA admin sign-in screen", async (t) => {
  const server = spawn("cmd.exe", ["/d", "/s", "/c", `npm exec vite -- --host 127.0.0.1 --port ${port} --strictPort`], {
    cwd: appDirectory,
    stdio: "ignore",
    windowsHide: true,
  });

  t.after(async () => {
    server.kill();
    await once(server, "exit").catch(() => {});
  });

  await waitForServer();
  const { stdout } = await execFile(chrome, ["--headless=new", "--disable-gpu", "--dump-dom", "--virtual-time-budget=1000", `http://127.0.0.1:${port}/login`], {
    windowsHide: true,
  });

  assert.match(stdout, /Admin platform/);
  assert.match(stdout, /src="\/brand\/senya-logo-primary\.svg"/);
  assert.match(stdout, /alt="SENYA"/);
  assert.match(stdout, /href="\/brand\/senya-brand-mark\.svg"/);
  assert.match(stdout, /Better models\./);
  assert.match(stdout, /Clearer signs\./);
  assert.match(stdout, /Train static and motion models, review accuracy, and publish updates for the SENYA app\./);
  assert.match(stdout, /Upload/);
  assert.match(stdout, /Train/);
  assert.match(stdout, /Review/);
  assert.match(stdout, /Publish/);
  assert.match(stdout, /Team access/);
  assert.match(stdout, /Manage SENYA's sign models\./);
  assert.match(stdout, /aria-label="Show password"/);
  assert.match(stdout, /type="submit"/);
});
