// Bug-hunt fix G101: frontmatter validate on a path outside the code root or on a directory is not reported as a missing file.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { P1, gsd, plan, project } from "../gsd-core/fixture.mjs";
import { makeTempDir } from "../helpers/temp.mjs";

test("G101 frontmatter validate: an outside-root path is refused, not reported as missing", async () => {
  const outside = makeTempDir();
  const outsideFile = path.join(outside, "outside.md");
  fs.writeFileSync(outsideFile, plan());
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  const viaParent = path.relative(p.root, outsideFile).split(path.sep).join("/");
  for (const file of [viaParent, outsideFile]) {
    const r = await gsd(p, ["frontmatter", "validate", file, "--schema", "plan"]);
    assert.equal(r.code, 1, file);
    assert.equal(r.json.status, "error", file);
    assert.match(r.json.error, /outside the code root/, file);
  }
});

test("G101 frontmatter validate: a directory in the root is refused, and a missing in-root file is still missing", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  fs.mkdirSync(p.path("adir.md"));
  const dir = await gsd(p, ["frontmatter", "validate", "adir.md", "--schema", "plan"]);
  assert.equal(dir.code, 1);
  assert.equal(dir.json.status, "error");
  assert.match(dir.json.error, /adir\.md is a directory/);
  const missing = await gsd(p, ["frontmatter", "validate", "missing-in-root.md", "--schema", "plan"]);
  assert.equal(missing.code, 66);
  assert.equal(missing.json.status, "missing");
  assert.match(missing.json.error, /no file missing-in-root\.md/);
});
