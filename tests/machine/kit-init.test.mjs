import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { runNode } from "../helpers/run.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const SKILL = path.join(KIT_DIR, "user", "skills", "kit-init");
const LINK_TYPE = process.platform === "win32" ? "junction" : "dir";

// A minimal kit: kit.mjs and kit.json at the root, the skill three levels below.
function tempKit() {
  const kit = makeTempDir("kit root ");
  fs.writeFileSync(path.join(kit, "kit.mjs"), "", "utf8");
  fs.writeFileSync(path.join(kit, "kit.json"), "{}", "utf8");
  fs.cpSync(SKILL, path.join(kit, "user", "skills", "kit-init"), { recursive: true });
  return kit;
}

test("INST-30 kit-root.mjs prints the kit root, also reached through a junction or directory symlink", async () => {
  const kit = tempKit();
  const direct = await runNode(path.join(kit, "user", "skills", "kit-init", "scripts", "kit-root.mjs"), []);
  assert.equal(direct.code, 0, direct.stderr);
  assert.equal(direct.stdout.trim(), fs.realpathSync(kit));
  const skills = path.join(makeTempDir("config dir "), "skills");
  fs.mkdirSync(skills, { recursive: true });
  fs.symlinkSync(path.join(kit, "user", "skills", "kit-init"), path.join(skills, "kit-init"), LINK_TYPE);
  const linked = await runNode(path.join(skills, "kit-init", "scripts", "kit-root.mjs"), []);
  assert.equal(linked.code, 0, linked.stderr);
  assert.equal(linked.stdout.trim(), fs.realpathSync(kit));
  const shipped = await runNode(path.join(SKILL, "scripts", "kit-root.mjs"), []);
  assert.equal(path.resolve(shipped.stdout.trim()), path.resolve(KIT_DIR));
});

test("INST-30 kit-root.mjs outside any kit fails with the message", async () => {
  const lone = makeTempDir("lone skill ");
  fs.cpSync(SKILL, path.join(lone, "kit-init"), { recursive: true });
  const r = await runNode(path.join(lone, "kit-init", "scripts", "kit-root.mjs"), []);
  assert.equal(r.code, 1);
  assert.equal(r.stderr.trim(), `failed: no paseo-kit root above ${path.join(fs.realpathSync(lone), "kit-init", "scripts")}`);
});

test("INST-30 the skill text: triggers, the /init exclusion, five steps, never force or pull", () => {
  const text = fs.readFileSync(path.join(SKILL, "SKILL.md"), "utf8");
  const description = /^description: (.*)$/m.exec(text)[1];
  for (const word of ["init", "initialize", "set up", "bootstrap", "khởi tạo", "/kit-init"]) assert.ok(description.includes(word), word);
  assert.match(description, /Not Claude Code's built-in \/init/);
  assert.match(text, /^name: kit-init$/m);
  const steps = [...text.matchAll(/^## (\d)\. (.*)$/gm)].map((m) => m[1]);
  assert.deepEqual(steps, ["1", "2", "3", "4", "5"]);
  assert.match(text, /Ask the owner before `git init`/);
  assert.match(text, /do not commit unless asked/);
  assert.match(text, /--enable-plugin/);
  assert.match(text, /Never add `--force` and never run `pull` without the owner's decision/);
  assert.match(text, /ph\.mjs doctor/);
  assert.match(text, /gsd-map-codebase/);
  assert.match(text, /adapter generator/);
  assert.match(text, /scripts\/kit-root\.mjs/);
  assert.match(text, /done, skipped .* or needs-owner/);
  assert.doesNotMatch(text, /backlog|syntax_check/i);
});
