// G180: install reports a kept part as a `conflict` line and update as a `kept` line, both exit 2. The kit-init skill must
// tell the owner to report both kinds, or an update that kept a local edit reads as clean.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";
import { makeKit, makeProject, runKit } from "../install/helpers.mjs";

const DEMO = ".claude/skills/demo/SKILL.md";
const HOOK = ".claude/hooks/io_guard.mjs";
const SKILL_MD = fs.readFileSync(path.join(KIT_DIR, "user", "skills", "kit-init", "SKILL.md"), "utf8");
const stepThree = /^## 3\. [\s\S]*?(?=^## 4\.)/m.exec(SKILL_MD)[0];
const summary = /^## Summary\r?\n([\s\S]*)$/m.exec(SKILL_MD)[1];

test("G180 update keeps a local hook edit as a kept line and exits 2", async () => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  p.write(HOOK, "// mine\n");
  const u = await runKit(["update", p.root], { kit });
  assert.equal(u.code, 2);
  assert.ok(u.out.some((line) => line.startsWith(`kept ${HOOK} (`)), u.out.join("\n"));
  assert.match(u.out.at(-1), /^update: 0 part\(s\) changed, \d+ kept; kit 1\.0\.0$/);
});

test("G180 the kit-init skill names the conflict lines of install and the kept lines of update, and the summary carries them", async () => {
  const kit = makeKit();
  const conflicted = makeProject({ [DEMO]: "project copy\n" });
  const install = await runKit(["install", conflicted.root], { kit });
  const kept = makeProject();
  await runKit(["install", kept.root], { kit });
  kept.write(HOOK, "// mine\n");
  const update = await runKit(["update", kept.root], { kit });
  const words = new Set([install.out, update.out].flat().map((line) => /^(conflict|kept) /.exec(line)?.[1]).filter(Boolean));
  assert.deepEqual([...words].sort(), ["conflict", "kept"]);
  for (const word of words) assert.match(stepThree, new RegExp(`\`${word}\` line`), `step 3 names the ${word} lines`);
  assert.match(stepThree, /stop for the owner/);
  assert.match(summary, /kept/);
});
