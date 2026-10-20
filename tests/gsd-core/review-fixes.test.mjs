// Regression tests for the GSD-core code review (CR-GSC-01..12).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { covers, overlaps, ownsPath } from "../../ship/.agents/harness/gsd/adapter-hooks.mjs";
import { waveOverlaps } from "../../ship/.agents/harness/gsd/plan-checks.mjs";
import { normalizeTestCommand } from "../../ship/.agents/harness/gsd/tools.mjs";
import { frontmatter, parseYaml } from "../../ship/.agents/harness/gsd/yaml.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { P1, gsd, plan, project, summary } from "./fixture.mjs";

const KIT = fileURLToPath(new URL("../../", import.meta.url));
const WIN = process.platform === "win32";

// Every file below dir: relative path -> content, to prove a refusal changed nothing.
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

test("GSDC-10 state wave and override persist the stdin records the GSD scripts send; a bad record writes nothing", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  await gsd(p, ["state", "init"]);
  const wave = await gsd(p, ["state", "wave", "--phase", "1", "--wave", "2"], { stdin: JSON.stringify({ plans: ["01-01", "01-02"], verify: "green", evidence: "_workspace/e.json" }) });
  assert.equal(wave.code, 0, JSON.stringify(wave.json));
  assert.deepEqual(wave.json.updated, ["Wave log"]);
  const ov = await gsd(p, ["state", "override", "--phase", "1"], { stdin: JSON.stringify({ reason: "owner accepts", issues: ["01-01: still open", "phase: cap"] }) });
  assert.equal(ov.code, 0, JSON.stringify(ov.json));
  const text = p.read(".planning/STATE.md");
  assert.match(text, /## Wave log\n\n- \d{4}-\d\d-\d\d phase 1 wave 2: plans 01-01, 01-02; verify green; evidence _workspace\/e\.json/);
  assert.match(text, /## Overrides\n\n- \d{4}-\d\d-\d\d: owner override: owner accepts\n {2}accepted issue: 01-01: still open\n {2}accepted issue: phase: cap/);
  const before = p.read(".planning/STATE.md");
  for (const [argv, stdin] of [
    [["state", "wave", "--phase", "1", "--wave", "3"], "not json"],
    [["state", "wave", "--phase", "1", "--wave", "3"], JSON.stringify({ verify: "green" })],
    [["state", "override", "--phase", "1"], JSON.stringify({ issues: ["x"] })],
    [["state", "override", "--phase", "1"], ""],
  ]) {
    const r = await gsd(p, argv, { stdin });
    assert.equal(r.code, 1, `${argv.join(" ")} <- ${stdin}`);
  }
  assert.equal(p.read(".planning/STATE.md"), before);
  assert.equal((await gsd(p, ["state", "override", "--phase", "1", "--text", "plain text"])).code, 0, "the text form is kept");
});

test("GSDC-15 phase remove refuses the active phase and any phase with owner work, leaving the tree byte-identical", async () => {
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan() } });
  await gsd(p, ["state", "init"]);
  await gsd(p, ["state", "position", "--phase", "2"]);
  const planning = () => tree(p.path(".planning"));
  let before = planning();
  const active = await gsd(p, ["phase", "remove", "2"]);
  assert.equal(active.code, 1);
  assert.match(active.json.error, /not in the future/);
  assert.deepEqual(planning(), before);
  await gsd(p, ["state", "position", "--phase", "1"]);
  for (const [name, text] of [["02-CONTEXT.md", "<decisions>D-01</decisions>\n"], ["02-RESEARCH.md", "# Research\n"], ["DISCUSS-CHECKPOINT.json", "{}"], ["notes.txt", "owner notes"]]) {
    p.write(`.planning/phases/02-api/${name}`, text);
    before = planning();
    const r = await gsd(p, ["phase", "remove", "2"]);
    assert.equal(r.code, 1, name);
    assert.match(r.json.error, new RegExp(name.replace(".", "\\.")), name);
    assert.deepEqual(planning(), before, name);
    fs.rmSync(p.path(`.planning/phases/02-api/${name}`));
  }
  fs.mkdirSync(p.path(".planning/phases/02-ui"));
  p.write(".planning/phases/02-ui/keep.md", "someone else's");
  before = planning();
  const clash = await gsd(p, ["phase", "remove", "2"]);
  assert.equal(clash.code, 1);
  assert.match(clash.json.error, /would overwrite \.planning\/phases\/02-ui/);
  assert.deepEqual(planning(), before);
  fs.rmSync(p.path(".planning/phases/02-ui"), { recursive: true });
  const ok = await gsd(p, ["phase", "remove", "2"]);
  assert.equal(ok.code, 0, JSON.stringify(ok.json));
  assert.deepEqual(ok.json.renumbered, [{ from: "3", to: "2" }]);
});

test("GSDC-16 an empty, draft or malformed UAT is never a passed human verification", async () => {
  const cases = {
    empty: "",
    draft: "---\nstatus: testing\n---\n## Tests\n",
    malformed: "## Tests\n\n### 1. A\nresult: pass\n\n### B without a number\nresult: pending\n",
  };
  for (const [name, text] of Object.entries(cases)) {
    const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan(), [`${P1}/01-01-SUMMARY.md`]: summary("01"), [`${P1}/01-UAT.md`]: text } });
    const r = await gsd(p, ["phase", "uat-passed", "1"]);
    assert.equal(r.code, 1, name);
    assert.equal(r.json.passed, false, name);
    assert.ok(r.json.blockers.length > 0, name);
  }
});

test("GSDC-23 ownership compares canonical paths: Windows case aliases overlap, dot segments never escape the owned tree", () => {
  assert.equal(covers("src", "src/../secret.txt"), false);
  assert.equal(covers("src", "./src/./a.ts"), true);
  assert.equal(covers("src", "../src/a.ts"), false);
  assert.equal(ownsPath("Path:src/x/..", [{ prefix: "Path:", maps_to: "<path>" }]), null);
  assert.equal(ownsPath("Path:x", [{ prefix: "Path:", maps_to: "../<path>" }]), null);
  const plans = [
    { id: "01-01", wave: 1, filesModified: ["src/Foo.ts"] },
    { id: "01-02", wave: 1, filesModified: ["src\\foo.ts"] },
  ];
  const hits = waveOverlaps(plans, () => []).filter((x) => x.kind === "overlapping-files");
  assert.equal(hits.length, WIN ? 1 : 0);
  assert.equal(overlaps("src/Foo", "src/foo/bar.ts"), WIN);
});

test("GSDC-23 check owns: a traversal path and a junction alias are problems before any handoff", async () => {
  const p = project({
    files: {
      [`${P1}/01-01-PLAN.md`]: plan({ files: "[src/../secret.txt]", owns: '["Path:src/"]' }),
      "real/a.js": "",
    },
  });
  const r = await gsd(p, ["check", "owns", "1"]);
  assert.equal(r.code, 1);
  assert.ok(r.json.problems.some((x) => x.kind === "outside-owns" && x.file === "src/../secret.txt"), JSON.stringify(r.json.problems));
  const h = await gsd(p, ["handoff", "1"]);
  assert.equal(h.code, 1);
  assert.ok(!fs.existsSync(p.path(`${P1}/handoff`)), "no handoff written");
  try {
    fs.symlinkSync(p.path("real"), p.path("alias"), "junction");
  } catch (e) {
    if (e.code === "EPERM") return;
    throw e;
  }
  p.write(`${P1}/01-01-PLAN.md`, plan({ files: "[alias/a.js]", owns: '["Path:alias/"]' }));
  const aliased = await gsd(p, ["check", "owns", "1"]);
  assert.equal(aliased.code, 1);
  assert.ok(aliased.json.problems.some((x) => x.kind === "aliased-path" && x.file === "alias/a.js"), JSON.stringify(aliased.json.problems));
});

test("GSDC-35 a key-link pattern found only in the target is not wiring; the verifier's PLAN-file form works", async () => {
  const extra = `  artifacts:\n    - path: src/impl.js\n      contains: parseThing\n  key_links:\n    - from: docs/unrelated.txt\n      to: src/impl.js\n      pattern: "export function parseThing"\n    - from: src/use.js\n      to: src/impl.js\n      pattern: "import .*impl"\n`;
  const p = project({ files: { [`${P1}/01-01-PLAN.md`]: plan({ extra }), "docs/unrelated.txt": "licence text\n", "src/impl.js": "export function parseThing() {}\n", "src/use.js": "import { parseThing } from './impl.js';\n" } });
  const planFile = `${P1}/01-01-PLAN.md`;
  const k = await gsd(p, ["verify", "key-links", planFile]);
  assert.equal(k.code, 1, JSON.stringify(k.json));
  assert.equal(k.json.all_verified, false);
  assert.deepEqual(k.json.links.map((l) => [l.status, l.verified]), [["not_found", false], ["verified", true]]);
  assert.match(k.json.links[0].detail, /not found in source/);
  assert.deepEqual([k.json.verified, k.json.total], [1, 2]);
  const a = await gsd(p, ["verify", "artifacts", planFile]);
  assert.equal(a.code, 0, JSON.stringify(a.json));
  assert.deepEqual([a.json.all_passed, a.json.passed, a.json.total, a.json.artifacts[0].exists], [true, 1, 1, true]);
  for (const verb of ["artifacts", "key-links"]) {
    assert.equal((await gsd(p, ["verify", verb, `${P1}/01-09-PLAN.md`])).code, 69, `${verb}: a missing PLAN could not be looked at`);
  }
  p.write(`${P1}/01-02-PLAN.md`, plan({ id: "02" }));
  assert.equal((await gsd(p, ["verify", "artifacts", `${P1}/01-02-PLAN.md`])).code, 66, "a valid PLAN without artifacts");
  p.write(`${P1}/01-03-PLAN.md`, "---\nphase: [unclosed\n---\n");
  assert.equal((await gsd(p, ["verify", "artifacts", `${P1}/01-03-PLAN.md`])).code, 69, "an unparseable PLAN");
});

test("GSDC-05 duplicate flow keys and __proto__ keys are line errors, never inherited fields", () => {
  for (const [src, line] of [
    ["x: {status: passed, status: gaps_found}", 1],
    ["phase: one\n__proto__: {status: passed}", 2],
    ["a:\n  b: {__proto__: {status: passed}}", 2],
    ["- {__proto__: 1}", 1],
  ]) {
    const r = parseYaml(src);
    assert.ok(r.error, src);
    assert.equal(r.line, line, `${src}: ${r.error}`);
  }
  const fm = frontmatter("---\n__proto__:\n  status: passed\nphase: one\n---\n");
  assert.ok(fm.error);
  assert.equal(fm.fm.status, undefined);
});

test("GSDC-28 editing or adding an include of the researcher role changes the research revision", async () => {
  const agent = (includes) => `---\nname: gsd-phase-researcher\ninclude:\n${includes.map((i) => `  - ${i}`).join("\n")}\n---\nResearch.\n`;
  const p = project({ files: { ".agents/agents/gsd-phase-researcher.md": agent([".agents/gsd/overlays/kit-core.md", ".agents/workflows/overlays/gsd-phase-researcher.md"]), ".agents/gsd/overlays/kit-core.md": "core\n", ".agents/workflows/overlays/gsd-phase-researcher.md": "flow overlay\n", ".agents/extra.md": "extra\n" } });
  const hash = async () => (await gsd(p, ["revisions", "hash", "1", "research"])).json;
  const first = await hash();
  assert.ok(first.files.includes("harness:.agents/workflows/overlays/gsd-phase-researcher.md"), first.files.join());
  await gsd(p, ["revisions", "record", "1", "research"]);
  p.write(".agents/workflows/overlays/gsd-phase-researcher.md", "flow overlay, edited\n");
  assert.equal((await gsd(p, ["revisions", "check", "1", "research"])).code, 1, "edited include");
  await gsd(p, ["revisions", "record", "1", "research"]);
  p.write(".agents/agents/gsd-phase-researcher.md", agent([".agents/gsd/overlays/kit-core.md", ".agents/workflows/overlays/gsd-phase-researcher.md", ".agents/extra.md"]));
  await gsd(p, ["revisions", "record", "1", "research"]);
  assert.ok((await hash()).files.includes("harness:.agents/extra.md"));
  p.write(".agents/extra.md", "extra, edited\n");
  assert.equal((await gsd(p, ["revisions", "check", "1", "research"])).code, 1, "edited new include");
});

test("GSDC-41 normalize-test-command leaves unknown commands, quoted text and one-shot options unchanged", () => {
  for (const c of ["node test.mjs --watch=false", `node -e "console.log('a  b')"`, `pytest "tests/my  dir" -q`, "npm test -- --watch", "make  test"]) assert.equal(normalizeTestCommand(c), c);
  assert.equal(normalizeTestCommand(`npx vitest watch "src/a  b.test.ts"`), `npx vitest run "src/a  b.test.ts"`);
  assert.equal(normalizeTestCommand("jest --watchAll --runInBand"), "jest --runInBand");
  assert.equal(normalizeTestCommand("jest --watchAll=false"), "jest --watchAll=false");
  assert.equal(normalizeTestCommand("ng test --watch"), "ng test --watch=false");
});

const SHA = "1111111111111111111111111111111111111111";

// A minimal untrusted clone and an install target whose inventory seeds one agent.
function cloneAndTarget(files) {
  const base = makeTempDir("paseo kit up ");
  const clone = path.join(base, "clone");
  const write = (root, rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  for (const [rel, text] of Object.entries({ ".git/HEAD": `${SHA}\n`, "agents/gsd-x.md": "---\nname: gsd-x\n---\nRead gsd-core/references/r1.md\n", "gsd-core/references/r1.md": "leaf\n", ...files })) write(clone, rel, text);
  const target = path.join(base, "target");
  const inventory = { v: 1, entries: [{ installed: ".agents/agents/gsd-x.md", kind: "agent", source: "agents/gsd-x.md", transformations: ["path-rewrite"], model: "pro", description: "X", include: [] }], extra_verbs: {} };
  write(target, ".agents/gsd/inventory.json", JSON.stringify(inventory));
  write(base, "outside.md", "outside the clone\n");
  write(base, "elsewhere/r1.md", "linked\n");
  return { base, clone, target };
}
const vendor = (t, clone) => gsd(t, ["upstream", "vendor", "--target", t, "--from", clone, "--commit", SHA]);

test("GSDC-44 vendor refuses traversal references and ancestor junctions before touching the snapshot", async () => {
  const { base, clone, target } = cloneAndTarget({});
  assert.equal((await vendor(target, clone)).code, 0);
  const before = tree(target);
  fs.writeFileSync(path.join(clone, "gsd-core/references/r1.md"), "See gsd-core/references/../../../outside.md\n");
  const r = await vendor(target, clone);
  assert.equal(r.code, 1);
  assert.match(r.json.error, /leaves the upstream clone: gsd-core\/references\/\.\.\/\.\.\/\.\.\/outside\.md/);
  assert.deepEqual(tree(target), before, "snapshot unchanged");
  assert.ok(!fs.existsSync(path.join(target, ".agents/gsd/outside.md")));
  fs.writeFileSync(path.join(clone, "gsd-core/references/r1.md"), "leaf\n");
  fs.rmSync(path.join(clone, "gsd-core/references"), { recursive: true });
  try {
    fs.symlinkSync(path.join(base, "elsewhere"), path.join(clone, "gsd-core/references"), "junction");
  } catch (e) {
    if (e.code === "EPERM") return;
    throw e;
  }
  const j = await vendor(target, clone);
  assert.equal(j.code, 1);
  assert.match(j.json.error, /symlink/);
  assert.deepEqual(tree(target), before, "snapshot unchanged");
});

// A copy of the kit's installed GSD tree (.agents and the gsd-* skills) to break.
function shipCopy() {
  const copy = makeTempDir("paseo kit ship ");
  fs.cpSync(path.join(KIT, "ship/.agents"), path.join(copy, ".agents"), { recursive: true });
  fs.cpSync(path.join(KIT, "ship/.claude/skills"), path.join(copy, ".claude/skills"), { recursive: true });
  return copy;
}
const check = (copy) => gsd(KIT, ["upstream", "check", "--target", copy]);

test("GSDC-47 upstream check accepts project-owned agents beside the kit roles; an unlisted gsd-* agent fails", async () => {
  const copy = shipCopy();
  fs.writeFileSync(path.join(copy, ".agents/agents/project-architect.md"), "---\nname: project-architect\ninclude:\n  - .agents/gsd/overlays/kit-core.md\n---\nProject role.\n");
  const ok = await check(copy);
  assert.equal(ok.code, 0, JSON.stringify(ok.json.problems));
  fs.writeFileSync(path.join(copy, ".agents/agents/gsd-stray.md"), "x");
  assert.ok((await check(copy)).json.problems.includes("installed GSD method file not in the inventory: .agents/agents/gsd-stray.md"));
});

test("GSDC-53 the inventory lists the kit wrappers and scripts; a deleted kit overlay or wrapper fails check", async () => {
  const inv = JSON.parse(fs.readFileSync(path.join(KIT, "ship/.agents/gsd/inventory.json"), "utf8"));
  const listed = new Set(inv.entries.map((e) => e.installed));
  for (const d of fs.readdirSync(path.join(KIT, "ship/.claude/skills")).filter((n) => n.startsWith("gsd-"))) assert.ok(listed.has(`.claude/skills/${d}/SKILL.md`), d);
  for (const f of fs.readdirSync(path.join(KIT, "ship/.agents/workflows")).filter((n) => /^gsd-/.test(n))) assert.ok(listed.has(`.agents/workflows/${f}`), f);
  for (const d of ["lib/", "lenses/", "overlays/gsd-debugger.md"]) assert.ok([...listed].some((x) => x.startsWith(`.agents/workflows/${d}`)), d);
  for (const rel of [".agents/gsd/overlays/kit-core.md", ".agents/gsd/overlays/gsd-planner.md", ".agents/workflows/overlays/gsd-roadmapper.md", ".claude/skills/gsd-plan/SKILL.md", ".agents/workflows/gsd-plan.js"]) {
    const copy = shipCopy();
    fs.rmSync(path.join(copy, rel));
    const r = await check(copy);
    assert.equal(r.code, 1, rel);
    assert.ok(r.json.problems.includes(`installed GSD method file missing: ${rel}`), `${rel}: ${r.json.problems.join("; ")}`);
    if (rel.includes("overlays/")) assert.ok(r.json.problems.some((x) => x.startsWith("agent include missing: ") && x.endsWith(rel)), rel);
  }
});
