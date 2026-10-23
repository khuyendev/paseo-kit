// G097: artifact, key-link, frontmatter and summary reads must not follow a junction or link out of the code root.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { P1, gsd, plan, project, summary } from "../gsd-core/fixture.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

// A link at `at` to `target`; false when the platform refuses it (a file symlink needs a privilege on Windows).
function linkOutside(target, at, type) {
  try {
    fs.symlinkSync(target, at, type);
    return true;
  } catch (e) {
    if (e.code === "EPERM") return false;
    throw e;
  }
}

test("G097 artifact and key-link checks refuse a junction that leaves the code root", async () => {
  const outside = makeTempDir("paseo kit outside ");
  fs.writeFileSync(path.join(outside, "proof.txt"), "expected marker\n");
  fs.writeFileSync(path.join(outside, "secret.txt"), "EXTERNAL_SECRET_TOKEN\n");
  const extra = `  artifacts:\n    - path: src/a.js\n      contains: hello\n    - path: linked/proof.txt\n      contains: expected marker\n  key_links:\n    - from: linked/secret.txt\n      to: src/a.js\n      pattern: EXTERNAL_SECRET_TOKEN\n`;
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ extra }), "src/a.js": "hello\n" } });
  if (!linkOutside(outside, p.path("linked"), "junction")) return;
  const a = (await gsd(p, ["verify", "artifacts", "1", "--plans", "01"])).json;
  assert.deepEqual(a.results.map((r) => r.status), ["passed", "path_rejected"]);
  assert.equal(a.all_passed, false);
  const k = (await gsd(p, ["verify", "key-links", "1", "--plans", "01"])).json;
  assert.deepEqual(k.results.map((r) => r.status), ["path_rejected"]);
  assert.equal(k.all_verified, false);
});

test("G097 frontmatter get and validate refuse a junction that leaves the code root", async () => {
  const outside = makeTempDir("paseo kit outside ");
  fs.writeFileSync(path.join(outside, "ext.md"), "---\nstatus: EXTERNAL_STATUS\n---\n# Outside\n");
  fs.writeFileSync(path.join(outside, "plan.md"), plan());
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  if (!linkOutside(outside, p.path("linked"), "junction")) return;
  const get = await gsd(p, ["frontmatter", "get", "linked/ext.md", "status"]);
  assert.notEqual(get.code, 0);
  assert.doesNotMatch(get.stdout, /EXTERNAL_STATUS/);
  const validate = await gsd(p, ["frontmatter", "validate", "linked/plan.md", "--schema", "plan"]);
  assert.notEqual(validate.code, 0);
  assert.equal(validate.json?.valid, undefined);
});

test("G097 summary-extract skips a summary file link that leaves the code root", async () => {
  const outside = makeTempDir("paseo kit outside ");
  const ext = path.join(outside, "ext-summary.md");
  fs.writeFileSync(ext, "---\nphase: 01-core\nplan: 09\nkey-files: EXTERNAL_FRONTMATTER_VALUE\n---\n# Outside\n");
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-02-SUMMARY.md`]: summary("02") } });
  if (!linkOutside(ext, p.path(`${P1}/01-01-SUMMARY.md`), "file")) return;
  const r = await gsd(p, ["summary-extract", ".planning/phases/*/*-SUMMARY.md", "--fields", "key-files"]);
  assert.equal(r.code, 0, JSON.stringify(r.json));
  assert.deepEqual(r.json.summaries.map((s) => s.path), [`${P1}/01-02-SUMMARY.md`]);
  assert.doesNotMatch(r.stdout, /EXTERNAL_FRONTMATTER_VALUE/);
});
