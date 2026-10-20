import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { HELP } from "../../kit/install/state.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { claudeEnv, makeKit, makeProject, runKit, testEnv, treeHash } from "./helpers.mjs";

const OLDER = "failed: .agents/harness-kit.json was written by an older kit; move it aside (e.g. to .agents/harness-kit.old.json) and run install";

test("INST-31 an older manifest is refused by every verb; after moving it aside install lists conflicts", async () => {
  const kit = makeKit();
  const old = {
    kit: "C:/old/paseo-harness-kit",
    version: "0.1.0",
    files: { ".agents/skills/harness/SKILL.md": "0123456789abcdef", ".claude/skills/demo/SKILL.md": "fedcba9876543210" },
  };
  const p = makeProject({
    ".agents/harness-kit.json": JSON.stringify(old),
    ".agents/skills/harness/SKILL.md": "old skill\n",
    ".claude/hooks/subagent_file_tools.mjs": "// stub\n",
    ".claude/skills/demo/SKILL.md": "older text\n",
  });
  const before = treeHash(p.root);
  for (const verb of ["install", "update", "status", "pull"]) {
    const r = await runKit([verb, p.root], { kit });
    assert.equal(r.code, 1, verb);
    assert.deepEqual(r.err, [OLDER], verb);
  }
  assert.equal(treeHash(p.root), before);
  for (const bad of [{ version: "1", files: { a: "ab".repeat(32) }, kit: "x" }, { files: {} }, { version: "1" }]) {
    p.write(".agents/harness-kit.json", JSON.stringify(bad));
    assert.deepEqual((await runKit(["status", p.root], { kit })).err, [OLDER]);
  }
  p.write(".agents/harness-kit.json", JSON.stringify(old));
  fs.renameSync(p.path(".agents/harness-kit.json"), p.path(".agents/harness-kit.old.json"));
  const r = await runKit(["install", p.root], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes("conflict .claude/skills/demo/SKILL.md: the project has a different version and kept it (install --force replaces it)"));
  assert.equal(p.read(".agents/skills/harness/SKILL.md"), "old skill\n");
  assert.equal(p.read(".claude/hooks/subagent_file_tools.mjs"), "// stub\n");
  assert.deepEqual(p.json(".agents/harness-kit.old.json"), old);
  assert.ok(Object.values(p.manifest().files).every((d) => /^[0-9a-f]{64}$/.test(d)));
});

test("INST-32 records of kept parts keep their previous digest; only a pulled part records P", async () => {
  const kit = makeKit();
  for (const rel of ["A.md", "B.md", "C.md", "D.md"]) kit.write(rel, `${rel} kit\n`);
  kit.sync();
  const p = makeProject();
  await runKit(["install", p.root], { kit });
  p.write("A.md", "A local\n");
  p.write("B.md", "B local\n");
  kit.write("B.md", "B kit 2\n");
  p.write("C.md", "C local\n");
  kit.remove("C.md");
  kit.sync();
  p.write("D.md", "D local\n");
  const pick = () => Object.fromEntries(["A.md", "B.md", "C.md"].map((k) => [k, p.manifest().files[k]]));
  const recorded = pick();
  const states = async () => (await runKit(["status", p.root], { kit })).out.filter((l) => /^(local|both|removed-local) /.test(l)).map((l) => l.split(/\s+/).slice(0, 2).join(" "));
  const expected = ["local A.md", "both B.md", "removed-local C.md", "local D.md"];
  for (let i = 0; i < 2; i++) {
    assert.equal((await runKit(["update", p.root], { kit })).code, 2);
    assert.deepEqual(pick(), recorded);
    assert.deepEqual((await states()).sort(), [...expected].sort());
  }
  const dBefore = p.manifest().files["D.md"];
  const r = await runKit(["pull", p.root, "D.md"], { kit });
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(pick(), recorded);
  assert.notEqual(p.manifest().files["D.md"], dBefore);
  assert.equal(kit.read("D.md"), "D local\n");
  assert.deepEqual((await states()).sort(), ["local A.md", "both B.md", "removed-local C.md"].sort());
});

test("INST-22 --force leaves project skills, project hooks, seeds, removed-local files and owner .gitignore lines", async () => {
  const kit = makeKit();
  kit.write("retired.md", "r\n");
  kit.sync();
  const p = makeProject({ ".gitignore": "node_modules/\n", ".agents/harness.config.json": '{"max_subagents": 7}\n', ".claude/skills/mine/SKILL.md": "mine\n", "CLAUDE.md": "# mine\n" });
  p.write(".claude/settings.json", JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node .claude/hooks/mine.mjs" }] }] } }));
  await runKit(["install", p.root], { kit });
  p.write("retired.md", "edited\n");
  kit.remove("retired.md");
  kit.sync();
  const keep = [".agents/harness.config.json", ".claude/skills/mine/SKILL.md", "retired.md", ".agents/harness-history.md", ".claude/settings.json", "CLAUDE.md", ".gitignore"];
  const before = Object.fromEntries(keep.map((rel) => [rel, p.read(rel)]));
  const r = await runKit(["update", p.root, "--force"], { kit });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes(`kept retired.md (removed-local: ${HELP["removed-local"]})`));
  for (const rel of keep) assert.equal(p.read(rel), before[rel], rel);
  assert.equal(Object.hasOwn(p.manifest().files, ".claude/skills/mine/SKILL.md"), false);
  const { env, calls } = claudeEnv({ FAKE_CC_VERSION: "2.1.295" });
  const q = makeProject();
  const g = await runKit(["install", q.root, "--enable-plugin", "--force"], { kit, env });
  assert.equal(g.code, 1);
  assert.equal(fs.readdirSync(q.root).length, 0);
  assert.deepEqual(calls().map((c) => c.args), [["--version"]]);
});

test("INST-24 project skills are untouched and no link or .agents/skills tree is made", async () => {
  const kit = makeKit();
  const p = makeProject({ ".claude/skills/mine/SKILL.md": "mine\n" });
  for (const argv of [["install", p.root], ["update", p.root], ["update", p.root, "--force"]]) {
    await runKit(argv, { kit });
    assert.equal(p.read(".claude/skills/mine/SKILL.md"), "mine\n");
    assert.equal(Object.keys(p.manifest().files).some((k) => k.includes("/mine/")), false);
  }
  const links = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) links.push(path.join(dir, e.name));
      else if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  };
  walk(p.root);
  assert.deepEqual(links, []);
  assert.equal(p.exists(".agents/skills"), false);
  assert.equal(p.exists(".agents/harness-skills-links.json"), false);
});

test("INST-26 Backlog and legacy files are never read, moved or run", async () => {
  const bin = makeTempDir("paseo kit bin ");
  const log = path.join(bin, "backlog.log");
  fs.writeFileSync(path.join(bin, "backlog.cmd"), `@echo called>>"${log}"\r\n`);
  fs.writeFileSync(path.join(bin, "backlog"), `#!/bin/sh\necho called >> "${log}"\n`, { mode: 0o755 });
  const env = testEnv({ PATH: `${bin}${path.delimiter}${process.env.PATH}` });
  const kit = makeKit();
  const p = makeProject({ "backlog/tasks/x.md": "task\n", ".claude/harness.config.json": '{"a":1}\n', ".claude/harness-kit.json": "{}\n" });
  const out = [];
  for (const verb of ["install", "update"]) out.push((await runKit([verb, p.root], { kit, env })).stdout);
  assert.equal(p.read("backlog/tasks/x.md"), "task\n");
  assert.equal(p.read(".claude/harness.config.json"), '{"a":1}\n');
  assert.equal(p.read(".claude/harness-kit.json"), "{}\n");
  assert.doesNotMatch(out.join(""), /backlog/i);
  assert.equal(fs.existsSync(log), false);
  assert.equal(p.exists("backlog.config.yml") || p.exists(".backlog"), false);
});
