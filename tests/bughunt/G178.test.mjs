// G178: a node_modules folder is not proof that npm ci completed; an interrupted or failed install must be retried.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { makeTempDir } from "../helpers/temp.mjs";
import { makeMachine, SECRETS } from "../machine/helpers.mjs";

const BOTH = { "planning-panel": "planning-panel", office: "office" };
const plugin = (m, folder) => path.join(m.kitDir, "plugins", folder);
const npmCalls = (m, folder) => m.logOf("npm").filter((c) => c.cwd === plugin(m, folder)).map((c) => c.args);

// Fake npm CLI that leaves a partial node_modules and exits 1, like an install cut short by a failing registry.
function failingNpm() {
  const file = path.join(makeTempDir("paseo kit npm "), "npm-cli-fail.mjs");
  fs.writeFileSync(file, 'import fs from "node:fs";\nimport path from "node:path";\nfs.mkdirSync(path.join(process.cwd(), "node_modules", "aa-ok"), { recursive: true });\nprocess.exit(1);\n');
  return file;
}

test("G178 a node_modules folder left by an interrupted npm ci is not an install: apply runs npm ci again", async () => {
  const m = makeMachine({ plugins: BOTH });
  fs.mkdirSync(path.join(plugin(m, "planning-panel"), "node_modules"), { recursive: true });
  fs.writeFileSync(path.join(plugin(m, "planning-panel"), ".npm-ci-done"), "");
  fs.mkdirSync(path.join(plugin(m, "office"), "node_modules", "aa-ok"), { recursive: true });
  const r = await m.run(["apply", "--no-reload", "--enable-paseo-plugins"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(npmCalls(m, "office"), [["ci"]]);
  assert.ok(r.out.includes("ok Paseo plugin office dependencies installed"), r.stdout);
});

test("G178 a failed npm ci removes its partial node_modules; the next apply retries and then reports installed", async () => {
  const m = makeMachine({ plugins: BOTH });
  const r = await m.run(["apply", "--no-reload", "--enable-paseo-plugins"], { ...SECRETS, npm_execpath: failingNpm() });
  assert.equal(r.code, 2, r.stdout);
  assert.ok(r.out.includes("failed plugin office: npm ci exit 1"), r.stdout);
  assert.equal(fs.existsSync(path.join(plugin(m, "office"), "node_modules")), false);
  assert.equal(fs.existsSync(path.join(plugin(m, "office"), ".npm-ci-done")), false);
  const r2 = await m.run(["apply", "--no-reload", "--enable-paseo-plugins"], SECRETS);
  assert.equal(r2.code, 0, r2.stdout);
  assert.deepEqual(npmCalls(m, "office"), [["ci"]]);
  assert.ok(fs.existsSync(path.join(plugin(m, "office"), ".npm-ci-done")));
  assert.ok(r2.out.includes("ok Paseo plugin office dependencies installed"), r2.stdout);
});
