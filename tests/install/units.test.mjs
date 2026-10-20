import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileDigest, textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { isTestPath, listShipFiles, loadKit, templateScripts } from "../../kit/install/units.mjs";
import { classify, HELP } from "../../kit/install/state.mjs";
import { BLOCK_KEY, KIT_DIR, makeKit, makeProject, runKit, SHIP_DIR } from "./helpers.mjs";

test("INST-03 manifest keys are the kit.json units plus the block keys; tests never ship", async () => {
  const kit = makeKit();
  kit.write(".agents/harness/runtime/a.test.mjs", "test\n");
  kit.write(".agents/harness/tests/x.mjs", "x\n");
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const listed = JSON.parse(fs.readFileSync(path.join(kit.dir, "kit.json"), "utf8")).units;
  assert.deepEqual(Object.keys(p.manifest().files).sort(), [...listed, BLOCK_KEY].sort());
  assert.equal(p.exists(".agents/harness/runtime/a.test.mjs"), false);
  assert.equal(p.exists(".agents/harness/tests/x.mjs"), false);
  assert.equal(listShipFiles(kit.dir).some(isTestPath), false);
});

test("INST-03 self-check fails on a listed test file or a missing file", async () => {
  for (const [extra, message] of [["x.test.mjs", "kit.json lists a test file: x.test.mjs"], ["gone.mjs", "kit.json lists a missing file: gone.mjs"]]) {
    const kit = makeKit();
    if (extra === "x.test.mjs") kit.write(extra, "t\n");
    kit.setUnits([...listShipFiles(kit.dir), extra]);
    const p = makeProject();
    const r = await runKit(["install", p.root], { kit });
    assert.equal(r.code, 1);
    assert.deepEqual(r.err, [`failed: ${message}`]);
    assert.equal(fs.readdirSync(p.root).length, 0);
  }
  for (const rel of ["tests/a.mjs", "a/__tests__/b.js", "node_modules/x/i.js", "d/test_x.py", "a.spec.tsx", "b.test.cts"]) assert.ok(isTestPath(rel), rel);
  assert.equal(isTestPath(".claude/hooks/io_guard.mjs"), false);
});

test("INST-03 the shipped kit.json passes its self-check", () => {
  const kit = loadKit(KIT_DIR);
  assert.ok(kit.units.has(BLOCK_KEY));
  for (const key of kit.units.keys()) assert.equal(isTestPath(key), false, key);
});

test("INST-04 one line-ending-insensitive 64-hex digest; CRLF conversion and mtime leave status same", async () => {
  const lf = textDigest("a\nb\n");
  assert.match(lf, /^[0-9a-f]{64}$/);
  assert.equal(textDigest("a\r\nb\r\n"), lf);
  const dir = makeProject();
  dir.write("bin", "");
  fs.writeFileSync(dir.path("bin"), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  assert.equal(fileDigest(dir.path("bin")), fileDigest(dir.path("bin")));
  const kit = makeKit();
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  const rel = ".claude/skills/demo/SKILL.md";
  p.write(rel, p.read(rel).replace(/\n/g, "\r\n"));
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(p.path(rel), later, later);
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 0, s.stdout);
  assert.match(s.out.at(-1), /^status: every kit part is the same/);
});

test("INST-04 no second digest implementation in ship/ or kit/install", () => {
  const hits = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) scan(abs);
      else if (/\.(mjs|js|ts)$/.test(e.name) && /replace\(\/\\r\\n\/g, "\\n"\)[^\n]*createHash|createHash[^\n]*\\r\\n/.test(fs.readFileSync(abs, "utf8"))) hits.push(abs);
    }
  };
  scan(SHIP_DIR);
  scan(path.join(KIT_DIR, "kit", "install"));
  assert.deepEqual(hits, []);
});

test("INST-06 six-state table over every (P, K, I) pattern", () => {
  const rows = [
    [null, null, "i", "gone"],
    ["i", null, "i", "removed"],
    ["p", null, "i", "removed-local"],
    [null, "k", "i", "missing"],
    [null, "k", null, "missing"],
    ["k", "k", "i", "same"],
    ["k", "k", null, "same"],
    ["i", "k", "i", "kit-newer"],
    ["p", "k", "k", "local"],
    ["p", "k", "i", "both"],
    ["p", "k", null, "both"],
  ];
  for (const [P, K, I, state] of rows) assert.equal(classify(P, K, I), state, JSON.stringify([P, K, I]));
  assert.deepEqual(HELP, {
    missing: "update adds it",
    "kit-newer": "update takes it",
    local: "pull copies it into the kit; update --force replaces it with the kit version",
    both: "merge by hand, then pull --force or update --force",
    removed: "update deletes it",
    "removed-local": "delete or keep it by hand",
  });
});

test("INST-06 status prints the help text verbatim per state", async () => {
  const kit = makeKit();
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  p.write(".claude/skills/demo/SKILL.md", "local edit\n");
  fs.rmSync(p.path(".agents/harness/runtime/a.mjs"));
  kit.write(".claude/hooks/io_guard.mjs", "// newer\n");
  const s = await runKit(["status", p.root], { kit });
  assert.equal(s.code, 2);
  assert.ok(s.out.includes(`${"local".padEnd(13)} .claude/skills/demo/SKILL.md  (${HELP.local})`), s.stdout);
  assert.ok(s.out.includes(`${"missing".padEnd(13)} .agents/harness/runtime/a.mjs  (${HELP.missing})`));
  assert.ok(s.out.includes(`${"kit-newer".padEnd(13)} .claude/hooks/io_guard.mjs  (${HELP["kit-newer"]})`));
  assert.equal(s.out.at(-1), "status: 3 part(s) differ; project on kit 1.0.0, kit now 1.0.0");
});

test("HOOK-02 the managed hook set comes from the template; a template script outside kit.json fails the self-check", async () => {
  const template = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, "templates", "settings.hooks.json"), "utf8"));
  assert.deepEqual([...templateScripts(template)].sort(), ["bash_long_command", "context_guard", "io_guard", "syntax_check"]);
  const shippedHooks = listShipFiles(KIT_DIR).filter((rel) => /^\.claude\/hooks\/[^/]+\.mjs$/.test(rel)).map((rel) => path.basename(rel, ".mjs"));
  assert.deepEqual(shippedHooks.sort(), [...templateScripts(template)].sort());
  assert.equal(JSON.parse(fs.readFileSync(path.join(KIT_DIR, "kit.json"), "utf8")).units.includes(".claude/hooks/subagent_file_tools.mjs"), false);
  const kit = makeKit();
  const extra = structuredClone(template);
  extra.hooks.Stop = [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/new_hook.mjs"' }] }];
  kit.write("templates/settings.hooks.json", JSON.stringify(extra));
  const r = await runKit(["install", makeProject().root], { kit });
  assert.equal(r.code, 1);
  assert.deepEqual(r.err, ["failed: templates/settings.hooks.json names .claude/hooks/new_hook.mjs, which kit.json does not list"]);
});
