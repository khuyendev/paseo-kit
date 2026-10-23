// Kit feedback #87, part A (RA): a workflow composition reaches the kit only through flow and gsd verbs, so those verbs
// are the kit's stable API. A static scan of the compositions against the kit's verb tables runs in kit.mjs update,
// ph doctor and ph harness lint; docs/INTERFACES.md lists every verb (this test fails when one is missing).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadConfigLenient } from "../../ship/.agents/harness/config.mjs";
import { lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { checkCompositionVerbs, flowVerbNames, verbCalls, verbProblem } from "../../ship/.agents/harness/gsd/verb-check.mjs";
import { verbHandlers } from "../../ship/.agents/harness/gsd/verbs.mjs";
import { COMMAND_NAMES } from "../../ship/.agents/workflows/lib/gsd-flow.mjs";
import { connect } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { runDoctor } from "../../ship/.agents/harness/runtime/doctor.mjs";
import { KIT_DIR, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { defaultKitFiles, makeKit, makeProject, runKit } from "../install/helpers.mjs";
import { setup } from "../ph/setup.mjs";

const HEADER = [
  'const PH = ".agents/harness/ph.mjs";',
  'const FLOW = ".agents/workflows/lib/gsd-flow.mjs";',
  'const gsd = (argv, input) => run([PH, "gsd", ...argv], input);',
  'const flow = (argv, input) => run([FLOW, ...argv], input);',
].join("\n");
const BAD = `${HEADER}\nawait flow(["read", "x"]);\nawait flow(["state-frobnicate", phaseDir]);\nawait gsd(["websearch", "q"]);\nawait gsd(["roadmap", "explode"]);\n`;
const BAD_PROBLEMS = [
  { line: 6, msg: /^flow verb "state-frobnicate" is not a kit verb/ },
  { line: 7, msg: /^gsd verb "websearch" is not served by the kit: research provider is not installed/ },
  { line: 8, msg: /^gsd verb "roadmap" is not a kit verb/ },
];

function assertBad(problems, file) {
  assert.equal(problems.length, BAD_PROBLEMS.length, JSON.stringify(problems));
  problems.forEach((p, i) => {
    assert.equal(p.file, file);
    assert.equal(p.line, BAD_PROBLEMS[i].line);
    assert.match(p.msg, BAD_PROBLEMS[i].msg);
  });
}

test("RA verbCalls reads literal flow and gsd verbs (a.b, a b, query) and counts computed ones without checking them", () => {
  const text = [
    HEADER,
    'await flow(["exists", a, b]);',
    "await flow([ 'gate' , dir], {});",
    'await gsd(["debug", "status", slug]);',
    'await gsd(["state.load"]);',
    'await gsd(["query", "roadmap", "analyze"]);',
    "await gsd([`hash`], text);",
    "await gsd([...args, \"--x\"]);",
    "await gsd([\"debug\", sub, slug]);",
    "await flow([`${verb}`]);",
  ].join("\n");
  const r = verbCalls(text);
  assert.deepEqual(r.calls.map((c) => `${c.kind}:${c.verb}:${c.line}`), [
    "flow:exists:5", "flow:gate:6", "gsd:debug.status:7", "gsd:state.load:8", "gsd:roadmap.analyze:9", "gsd:hash:10",
  ]);
  assert.equal(r.dynamic, 3);
});

test("RA the flow verb table read from gsd-flow.mjs's text equals the verbs it serves; a missing file is a problem, not a crash", () => {
  assert.deepEqual(flowVerbNames(), COMMAND_NAMES);
  assert.equal(flowVerbNames(path.join(SHIP_DIR, "no-such-flow.mjs")), null);
  assert.match(verbProblem({ kind: "flow", verb: "read" }, null), /gsd-flow\.mjs is missing/);
});

test("RA a script without the shared helpers is not scanned (another flow() is not the kit's)", () => {
  assert.deepEqual(verbCalls('const flow = (x) => x;\nflow(["anything"]);\n'), { calls: [], dynamic: 0 });
});

test("RA every shipped composition calls only kit verbs", () => {
  const r = checkCompositionVerbs(SHIP_DIR);
  assert.ok(r.scripts >= 9 && r.calls > 200, JSON.stringify(r));
  assert.deepEqual(r.problems, []);
});

test("RA an unknown flow verb, a not-ported gsd verb and an unknown gsd verb are problems with file and line", () => {
  const p = makeTempProject({ git: false, files: { ".agents/workflows/gsd-mine.js": BAD } });
  assertBad(checkCompositionVerbs(p.root).problems, ".agents/workflows/gsd-mine.js");
});

test("RA kit.mjs update reports the unknown verbs of the project's compositions as problems and exits 2", async () => {
  const kit = makeKit({ files: { ...defaultKitFiles(), ".agents/workflows/gsd-demo.js": `${HEADER}\nawait flow(["read", "x"]);\n` } });
  const p = makeProject();
  assert.equal((await runKit(["install", p.root], { kit })).code, 0);
  const clean = await runKit(["update", p.root], { kit });
  assert.equal(clean.code, 0, clean.stdout);
  p.write(".agents/workflows/gsd-local.js", BAD);
  const r = await runKit(["update", p.root], { kit });
  assert.equal(r.code, 2, r.stdout);
  const lines = r.out.filter((l) => l.startsWith("problem .agents/workflows/gsd-local.js:"));
  assert.equal(lines.length, 3, r.stdout);
  assert.match(lines[0], /^problem \.agents\/workflows\/gsd-local\.js:6: flow verb "state-frobnicate" is not a kit verb/);
});

async function doctor(s) {
  const { cfg, error } = loadConfigLenient(s.root);
  const out = [];
  let session;
  const ctx = {
    env: s.env, root: s.root, cfg, configError: error, clock: s.clock, out: (l) => out.push(l),
    paseo: () => (session ??= connect({ env: s.env, root: s.root, cfg, clock: s.clock, daemon: s.fake.daemon })),
  };
  const code = await runDoctor(ctx, { freemem: () => 64 * 2 ** 30, claudeVersionText: () => "2.1.300 (Claude Code)" });
  return { code, out };
}

test("RA ph doctor: a problem per unknown verb (exit 2); ok with the counts when every verb is known; note without scripts", async () => {
  const none = await doctor(setup());
  assert.ok(none.out.includes("note composition verbs: no workflow scripts in .agents/workflows/"), none.out.join("\n"));
  const good = setup({ files: { ".agents/workflows/gsd-ok.js": `${HEADER}\nawait flow(["read", "x"]);\nawait gsd(["debug", sub]);\n` } });
  const ok = await doctor(good);
  assert.ok(ok.out.includes("ok composition verbs: 1 workflow script(s), 1 flow and gsd calls use kit verbs (1 with a computed verb not checked)"), ok.out.join("\n"));
  const bad = setup({ files: { ".agents/workflows/gsd-bad.js": BAD } });
  const r = await doctor(bad);
  assert.equal(r.code, 2);
  const lines = r.out.filter((l) => l.startsWith("problem composition "));
  assert.equal(lines.length, 3, r.out.join("\n"));
  assert.match(lines[1], /^problem composition \.agents\/workflows\/gsd-bad\.js:7: gsd verb "websearch" is not served by the kit/);
});

test("RA ph harness lint fails each unknown verb of a composition at its line", () => {
  const p = makeTempProject({ git: false, overlay: {}, files: { ".agents/workflows/gsd-bad.js": BAD } });
  const fails = lintProject(p.root).findings.filter((f) => f.file === ".agents/workflows/gsd-bad.js");
  assert.ok(fails.every((f) => f.level === "fail"));
  assertBad(fails, ".agents/workflows/gsd-bad.js");
});

test("RA docs/INTERFACES.md section 'Kit verbs (stable API)' lists every flow verb and every ported ph gsd verb, and the rename rule", () => {
  const doc = fs.readFileSync(path.join(KIT_DIR, "docs", "INTERFACES.md"), "utf8");
  const start = doc.search(/^## \d+\. Kit verbs \(stable API\)$/m);
  assert.ok(start >= 0, "INTERFACES.md has the section");
  const rest = doc.slice(start + 1);
  const end = rest.search(/^## /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const missing = [
    ...COMMAND_NAMES.filter((v) => !section.includes(`\`${v}\``)).map((v) => `flow ${v}`),
    ...Object.keys(verbHandlers).filter((v) => !section.includes(`\`${v}\``)).map((v) => `gsd ${v}`),
  ];
  assert.deepEqual(missing, [], "add a row for each verb to the section");
  assert.match(section, /CHANGELOG/);
  assert.match(section, /compatibility alias for one release/);
});
