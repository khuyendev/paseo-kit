import assert from "node:assert/strict";
import test from "node:test";
import { makeKit, makeProject, runKit, treeHash } from "../install/helpers.mjs";

// G181: a settings.json hooks value the wiring step cannot reconcile must fail before install or update copies any kit file.
const settingsWith = (hooks) => JSON.stringify({ hooks }, null, 2);
const notAList = (event) => `failed: .claude/settings.json: hooks.${event} is not a list of hook groups; fix it by hand`;
const notAnObject = `failed: .claude/settings.json: "hooks" is not an object; fix it by hand`;

test("G181 install refuses a template event whose value is not a list, names the event, and writes nothing", async () => {
  for (const event of ["PreToolUse", "UserPromptSubmit"]) {
    for (const value of ["owner-hook-data", {}]) {
      const kit = makeKit();
      const p = makeProject({ ".claude/settings.json": settingsWith({ [event]: value }) });
      const before = treeHash(p.root);
      const r = await runKit(["install", p.root], { kit });
      assert.equal(r.code, 1, r.stdout);
      assert.deepEqual(r.err, [notAList(event)]);
      assert.equal(treeHash(p.root), before);
      assert.equal(p.exists(".claude/hooks/io_guard.mjs"), false);
      assert.equal(p.exists(".agents/harness-kit.json"), false);
    }
  }
});

test("G181 update refuses the same value before it copies a changed kit file", async () => {
  const kit = makeKit();
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  p.write(".claude/settings.json", settingsWith({ PreToolUse: "owner-hook-data" }));
  kit.write(".claude/hooks/io_guard.mjs", "// changed in the kit\n");
  kit.sync();
  const before = treeHash(p.root);
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 1, r.stdout);
  assert.deepEqual(r.err, [notAList("PreToolUse")]);
  assert.equal(treeHash(p.root), before);
});

test("G181 install refuses a hooks value that is not an object, with nothing written", async () => {
  for (const hooks of ["owner-hook-data", [], null]) {
    const kit = makeKit();
    const p = makeProject({ ".claude/settings.json": settingsWith(hooks) });
    const before = treeHash(p.root);
    const r = await runKit(["install", p.root], { kit });
    assert.equal(r.code, 1, JSON.stringify(hooks));
    assert.deepEqual(r.err, [notAnObject]);
    assert.equal(treeHash(p.root), before);
  }
});

test("G181 install refuses a settings file that is not valid JSON or not an object, with nothing written", async () => {
  for (const text of ["{", "[]"]) {
    const kit = makeKit();
    const p = makeProject({ ".claude/settings.json": text });
    const before = treeHash(p.root);
    const r = await runKit(["install", p.root], { kit });
    assert.equal(r.code, 1, text);
    assert.match(r.err[0], /^failed: /, text);
    assert.equal(treeHash(p.root), before);
  }
});

test("G181 a non-list value under an event the kit does not template is kept and does not block install", async () => {
  const kit = makeKit();
  const p = makeProject({ ".claude/settings.json": settingsWith({ Stop: "owner-hook-data" }) });
  const r = await runKit(["install", p.root], { kit });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(p.json(".claude/settings.json").hooks.Stop, "owner-hook-data");
});
