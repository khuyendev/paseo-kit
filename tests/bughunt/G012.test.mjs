// G012: an interrupted or failed phase add, insert or remove, or a shared-file write with a broken STATE.md, leaves the
// ROADMAP and the phase directories in step, and a retry does not number a second phase.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { gsd, project } from "../gsd-core/fixture.mjs";

function tree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else out[path.relative(dir, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf8");
    }
  };
  walk(dir);
  return out;
}

const planning = (p) => tree(p.path(".planning"));
const headings = (p) => (p.read(".planning/ROADMAP.md").match(/^### Phase .*$/gm) ?? []);

test("G012 phase add: a directory that cannot be created leaves ROADMAP untouched; the retry numbers the phase once", async () => {
  const p = project();
  await gsd(p, ["state", "init"]);
  p.write(".planning/phases/04-docs", "a file in the way");
  const before = planning(p);
  const blocked = await gsd(p, ["phase", "add", "Docs"]);
  assert.equal(blocked.code, 1, JSON.stringify(blocked.json));
  assert.deepEqual(planning(p), before);
  fs.rmSync(p.path(".planning/phases/04-docs"));
  const ok = await gsd(p, ["phase", "add", "Docs"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.phase, "4");
  assert.deepEqual(headings(p).slice(-1), ["### Phase 4: Docs"]);
  assert.ok(fs.existsSync(p.path(".planning/phases/04-docs")));
});

test("G012 phase add: a retry completes a roadmap entry that an interrupted add left without its directory", async () => {
  const p = project();
  await gsd(p, ["state", "init"]);
  assert.equal((await gsd(p, ["phase", "add", "Docs"])).json.phase, "4");
  fs.rmSync(p.path(".planning/phases/04-docs"), { recursive: true });
  const again = await gsd(p, ["phase", "add", "Docs"]);
  assert.equal(again.code, 0, JSON.stringify(again.json));
  assert.equal(again.json.phase, "4");
  assert.equal(again.json.resumed, true);
  assert.equal(headings(p).filter((h) => h.endsWith("Docs")).length, 1);
  assert.ok(fs.existsSync(p.path(".planning/phases/04-docs")));
});

test("G012 phase insert: a directory that cannot be created leaves ROADMAP untouched; the retry numbers the phase once", async () => {
  const p = project();
  await gsd(p, ["state", "init"]);
  p.write(".planning/phases/02.1-hot-fix", "a file in the way");
  const before = planning(p);
  const blocked = await gsd(p, ["phase", "insert", "2", "Hot", "fix"]);
  assert.equal(blocked.code, 1, JSON.stringify(blocked.json));
  assert.deepEqual(planning(p), before);
  fs.rmSync(p.path(".planning/phases/02.1-hot-fix"));
  const ok = await gsd(p, ["phase", "insert", "2", "Hot", "fix"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.equal(ok.json.phase, "2.1");
  assert.equal(headings(p).filter((h) => h.includes("Hot fix")).length, 1);
});

test("G012 a shared-file write with a malformed STATE.md changes no planning file", async () => {
  const p = project();
  await gsd(p, ["state", "init"]);
  p.write(".planning/STATE.md", "---\nstatus: [broken\n---\n");
  const before = planning(p);
  for (const argv of [["phase", "add", "Docs"], ["phase", "insert", "2", "Hot", "fix"], ["phase", "remove", "3"]]) {
    const r = await gsd(p, argv);
    assert.equal(r.code, 1, argv.join(" "));
    assert.match(r.json.error, /STATE\.md frontmatter/, argv.join(" "));
    assert.deepEqual(planning(p), before, argv.join(" "));
  }
});

test("G012 phase remove: a renumber that fails part-way is rolled back; the tree is byte-identical and a retry renumbers", async () => {
  const p = project();
  await gsd(p, ["state", "init"]);
  // A file that cannot take the name of a directory: the rename of `03-NOTES.md` to `02-NOTES.md` fails after phase 3 moved.
  p.write(".planning/phases/03-ui/03-NOTES.md", "notes");
  fs.mkdirSync(p.path(".planning/phases/03-ui/02-NOTES.md"));
  const before = planning(p);
  const failed = await gsd(p, ["phase", "remove", "2"]);
  assert.equal(failed.code, 1, JSON.stringify(failed.json));
  assert.deepEqual(planning(p), before);
  fs.rmSync(p.path(".planning/phases/03-ui/02-NOTES.md"), { recursive: true });
  const ok = await gsd(p, ["phase", "remove", "2"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.renumbered, [{ from: "3", to: "2" }]);
  assert.match(p.read(".planning/ROADMAP.md"), /### Phase 2: Ui/);
  assert.ok(fs.existsSync(p.path(".planning/phases/02-ui/02-NOTES.md")));
  assert.ok(!fs.existsSync(p.path(".planning/phases/03-ui")));
  assert.deepEqual(fs.readdirSync(p.path(".planning/phases")).filter((n) => n.startsWith(".")), []);
});
