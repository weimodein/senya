import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8");

test("admin shell and pages expose the refined reference structure", () => {
  const ui = read("src/components/ui.jsx");
  const css = read("src/index.css");
  const layout = read("src/components/Layout.jsx");
  const signs = read("src/pages/Signs.jsx");
  const detail = read("src/pages/SignDetail.jsx");
  const models = read("src/pages/Models.jsx");
  const login = read("src/pages/Login.jsx");

  assert.match(css, /#f6f7f9/i);
  assert.match(layout, /senya-logo-primary\.svg/);
  assert.match(layout, /<header className="sticky top-0 z-50 /);
  assert.match(layout, /Server/);
  assert.match(layout, /ML service/);
  assert.match(signs, /Motion samples/);
  assert.match(signs, /View models/);
  assert.match(detail, /Choose files/);
  assert.match(detail, /Preview frames/);
  assert.match(detail, /grid items-start gap-6 lg:grid-cols-/);
  assert.doesNotMatch(detail, /<Card eyebrow="Add samples" title="Upload clips" className="h-full">/);
  assert.doesNotMatch(detail, /<Card eyebrow="Recording guidance" title=.*className="h-full">/);
  assert.match(models, /Published version/);
  assert.match(models, /Available for phone downloads/);
  assert.match(ui, /role="listbox"/);
  assert.match(ui, /export function ConfirmDialog/);
  assert.doesNotMatch(models, /window\.confirm/);
  assert.doesNotMatch(detail, /window\.confirm/);
  assert.match(login, /grid-cols-2/);
  assert.match(login, /grid-cols-1/);
  assert.match(login, /max-w-full/);
  assert.match(login, /overflow-x-hidden/);
  assert.match(login, /sm:grid-cols-4/);
  assert.match(login, /min-w-0/);
});
