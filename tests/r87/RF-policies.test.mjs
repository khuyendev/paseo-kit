// Kit feedback 87 (RF): every gsd.* and adapter.* setting is a verb or invariant setting or a composition policy, decided
// from the code that reads it; ph doctor notes a policy the overlay sets that the project's composition no longer reads.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfigLenient, loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { COMPOSITION_POLICIES, compositionPolicyLines } from "../../ship/.agents/harness/gsd/policies.mjs";
import { KIT_DIR, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { setup } from "../ph/setup.mjs";

const lf = (text) => text.replace(/\r\n/g, "\n");
const defaults = loadKitConfig();
const ALL_KEYS = [...Object.keys(defaults.gsd).map((k) => `gsd.${k}`), ...Object.keys(defaults.adapter).map((k) => `adapter.${k}`)];
const leaf = (key) => key.split(".")[1];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out);
    else if (/\.(mjs|js)$/.test(e.name)) out.push(abs);
  }
  return out;
}

// Kit modules other than the workflow scripts, the schema, the policy table itself and tests.
const kitModules = walk(path.join(SHIP_DIR, ".agents")).concat(walk(path.join(SHIP_DIR, ".claude", "hooks")))
  .map((abs) => ({ rel: path.relative(SHIP_DIR, abs).split(path.sep).join("/"), abs }))
  .filter(({ rel }) => !/^\.agents\/workflows\/gsd-[^/]+\.js$/.test(rel) && !/config-schema\.mjs$|gsd\/policies\.mjs$|\/tests\//.test(rel))
  .map(({ rel, abs }) => ({ rel, code: lf(fs.readFileSync(abs, "utf8")).split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n") }));
const readsKey = (code, key) => new RegExp(`\\b(${key.startsWith("gsd.") ? "gsd|g" : "adapter|a"})\\??\\.${leaf(key)}\\b`).test(code);

function section43() {
  const doc = lf(fs.readFileSync(path.join(KIT_DIR, "docs", "INTERFACES.md"), "utf8"));
  const start = doc.indexOf("### 4.3 ");
  assert.ok(start > 0, "INTERFACES.md has section 4.3");
  const text = doc.slice(start, doc.indexOf("\n## 5. ", start));
  const row = (kind) => {
    const line = text.split("\n").find((l) => l.startsWith(`| ${kind} |`));
    assert.ok(line, `row ${kind}`);
    return [...line.matchAll(/`((?:gsd|adapter)\.[a-z_]+)`/g)].map((m) => m[1]);
  };
  return { kit: row("verb or invariant setting"), policy: row("composition policy") };
}

test("RF INTERFACES.md 4.3 classifies every gsd.* and adapter.* key exactly once; the policy row is the policies table", () => {
  const { kit, policy } = section43();
  const both = [...kit, ...policy];
  assert.deepEqual([...new Set(both)].sort(), [...ALL_KEYS].sort());
  assert.equal(both.length, new Set(both).size, "a key is listed twice");
  assert.deepEqual([...policy].sort(), Object.keys(COMPOSITION_POLICIES).sort());
});

// The default composition's own argument check (F62) validates the value for gsd-plan.js; it picks no step.
const ARG_CHECKS = { "gsd.skeleton_lanes": [".agents/harness/gsd/workflow-args.mjs"] };

test("RF a composition policy is read by its default readers and by no kit module; a kit setting by some kit module", () => {
  for (const [key, { via, readers }] of Object.entries(COMPOSITION_POLICIES)) {
    assert.ok(ALL_KEYS.includes(key), `${key} is a config key`);
    for (const rel of readers) {
      const text = lf(fs.readFileSync(path.join(SHIP_DIR, rel), "utf8"));
      const name = via === "script" ? new RegExp(`\\.${leaf(key)}\\b`) : new RegExp(`\`${key.replace(".", "\\.")}\``);
      assert.match(text, name, `${rel} reads ${key}`);
    }
    const readers2 = kitModules.filter((m) => readsKey(m.code, key) && !ARG_CHECKS[key]?.includes(m.rel)).map((m) => m.rel);
    assert.deepEqual(readers2, [], `${key} is read by kit modules: it is a verb or invariant setting`);
  }
  for (const key of ALL_KEYS.filter((k) => !COMPOSITION_POLICIES[k])) {
    assert.ok(kitModules.some((m) => readsKey(m.code, key)), `${key}: no kit module reads it; classify it as a composition policy`);
  }
});

const SCRIPT_READS_FLOW = "const g = cfg.gsd;\nconst flowMode = args.planFlow ?? g.plan_flow;\n";

test("RF compositionPolicyLines notes a set policy no workflow script names; ok when each is read; silent when none is set", () => {
  const p = makeTempProject({
    git: false,
    overlay: { gsd: { plan_flow: "streams", map_mode: "per-focus" }, adapter: { startup_globs: ["lib/main.dart"] } },
    files: { ".agents/workflows/gsd-plan.js": SCRIPT_READS_FLOW, ".agents/workflows/lib/x.mjs": "cfg.gsd.map_mode\n", ".claude/skills/gsd-verify/SKILL.md": "no globs here\n" },
  });
  const lines = compositionPolicyLines(p.root);
  assert.deepEqual(lines.map(([kind, text]) => `${kind} ${text.split(":")[0]}`), ["note composition policy gsd.map_mode", "note composition policy adapter.startup_globs"]);
  assert.match(lines[0][1], /no workflow script of this project \(\.agents\/workflows\/\*\.js\) reads it \(the kit default reads it in \.agents\/workflows\/gsd-map-codebase\.js\); it has no effect/);
  assert.match(lines[1][1], /no skill of this project/);
  p.write(".agents/workflows/gsd-map-codebase.js", "const mode = cfg.gsd.map_mode;\n");
  p.write(".claude/skills/gsd-verify/SKILL.md", "files matching `adapter.startup_globs`\n");
  assert.deepEqual(compositionPolicyLines(p.root), [["ok", "composition policies: 3 set in .agents/harness.config.json, each read by the project's composition"]]);
  const none = makeTempProject({ git: false, overlay: { gsd: { granularity: "fine" } }, files: { ".agents/workflows/gsd-plan.js": "g.granularity\n" } });
  assert.equal(compositionPolicyLines(none.root).length, 1);
  assert.deepEqual(compositionPolicyLines(makeTempProject({ git: false, overlay: { gsd: { isolation: "shared" } } }).root), []);
});

test("RF ph doctor prints the composition policy note as a note (exit unaffected) and skips it on a broken overlay", async () => {
  const s = setup({ overlay: { gsd: { checker_recheck: "incremental" } }, files: { ".agents/workflows/gsd-plan.js": SCRIPT_READS_FLOW } });
  const run = async () => {
    const { cfg, error } = loadConfigLenient(s.root);
    const out = [];
    let session;
    const ctx = {
      env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
      paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
    };
    const code = await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
    return { code, out };
  };
  const r = await run();
  assert.ok(r.out.some((l) => l.startsWith("note composition policy gsd.checker_recheck: set in .agents/harness.config.json")), r.out.join("\n"));
  assert.equal(r.out.some((l) => l.startsWith("problem composition")), false);
  fs.writeFileSync(path.join(s.root, ".agents", "harness.config.json"), "{broken");
  const broken = await run();
  assert.equal(broken.out.some((l) => /composition polic/.test(l)), false, broken.out.join("\n"));
});
