// Regression test for G052: a research input that leaves the project root is not read into the revision hash.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { P1, REQUIREMENTS, gsd, project } from "../gsd-core/fixture.mjs";

test("G052 revisions: a canonical ref or REQUIREMENTS spec outside the project root is skipped and reported", async () => {
  const outsideName = `g052-outside-${process.pid}.txt`;
  const outside = path.join(os.tmpdir(), outsideName);
  fs.writeFileSync(outside, "outside v1");
  try {
    const p = project({
      files: {
        [`${P1}/01-CONTEXT.md`]: `<decisions></decisions>\n<canonical_refs>\`docs/spec.md\` \`../${outsideName}\`</canonical_refs>`,
        "docs/spec.md": "spec",
        "src/a.js": "1",
      },
      requirements: REQUIREMENTS.replace("- [ ] **CORE-01**: Core starts", `- [ ] **CORE-01**: Core starts (spec: ../${outsideName})`),
    });
    const before = await gsd(p, ["revisions", "hash", "1", "research"]);
    assert.equal(before.code, 0);
    assert.ok(before.json.files.includes("docs/spec.md"), "an in-root ref is still hashed");
    assert.ok(!before.json.files.includes(`../${outsideName}`), "an outside ref is not a revision input");
    assert.deepEqual(before.json.skipped, [`../${outsideName}`]);

    fs.writeFileSync(outside, "outside v2");
    const after = await gsd(p, ["revisions", "hash", "1", "research"]);
    assert.equal(after.json.hash, before.json.hash, "a change outside the root does not change the hash");

    await gsd(p, ["revisions", "record", "1", "research"]);
    assert.equal((await gsd(p, ["revisions", "check", "1", "research"])).code, 0);
  } finally {
    fs.rmSync(outside, { force: true });
  }
});
