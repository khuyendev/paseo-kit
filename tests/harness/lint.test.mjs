// ph harness lint fixtures (HARN-05..10, 13, 18).
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeTempProject } from "../helpers/temp.mjs";
import { runPh } from "../helpers/run.mjs";
import { findingLine, lintProject } from "../../ship/.agents/harness/adapter/lint.mjs";
import { lintHistory, validateEvalRecord, validateTriggerRecord } from "../../ship/.agents/harness/adapter/records.mjs";

const SKILL = `---
name: web-stack
description: "How to write, build and test code in this Node web service. Use when writing or changing code under src/."
---

# Web stack

Write handlers in src/routes/.
`;

const triggers = (skill, should = 10, near = 10) => JSON.stringify({
  skill, date: "2026-10-20", model: "circle/gpt-6-luna-fast[1m]",
  requests: [...Array(should).fill(0).map((_, i) => ({ text: `do ${i}`, should_trigger: true, triggered: true })),
    ...Array(near).fill(0).map((_, i) => ({ text: `other ${i}`, should_trigger: false, triggered: false }))],
  precision: 1, recall: 1,
});

const history = (scope, extra = "") => `# Harness history

| Date | Change | Scope | Reason | Supersedes |
|------|--------|-------|--------|------------|
| 2026-10-19 | Earlier change | .agents/harness.config.json | first map | |
| 2026-10-20 | Generate adapter | ${scope} | map-codebase done | |
${extra}`;

const RESOLVER = "process.stdin.resume(); process.stdin.on('end', () => console.log(JSON.stringify({ v: 1, results: [] })));\n";

function cleanAdapter() {
  return {
    files: {
      ".claude/skills/web-stack/SKILL.md": SKILL,
      ".agents/skill-tests/web-stack/triggers.json": triggers("web-stack"),
      "tools/adapter/resolve-test.mjs": RESOLVER,
      ".agents/harness-history.md": history(".agents/harness.config.json, .claude/skills/web-stack/, tools/adapter/resolve-test.mjs"),
    },
    overlay: {
      adapter: {
        stack_skill: "web-stack",
        commands: { build: ["npm", "run", "build"], test: ["npm", "test"], build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: { jest: { argv: ["npx", "jest", "{targets}"], timeout_s: 600 } } },
        verify_vocabulary: {
          build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
          cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
          test: { prefix: "test:", parser: null, resolver: "tools/adapter/resolve-test.mjs", runner: "jest", evidence_parser: null, exit_code_sufficient: false },
        },
      },
      gsd: { roles: { executor: { model: "pro", effort: "medium", reason: "structural changes" } } },
    },
  };
}

// Lints a fixture: the clean adapter plus `files` (null deletes a file) and an optional overlay.
function lint({ files = {}, overlay, all = false } = {}) {
  const base = cleanAdapter();
  const merged = { ...base.files, ...files };
  for (const [k, v] of Object.entries(merged)) if (v === null) delete merged[k];
  const p = makeTempProject({ git: false, files: merged, overlay: overlay ?? base.overlay });
  const { findings } = lintProject(p.root, { all });
  return {
    root: p.root,
    fails: findings.filter((f) => f.level === "fail").map(findingLine),
    warns: findings.filter((f) => f.level === "warn").map(findingLine),
  };
}

const inScope = (paths) => ({ ".agents/harness-history.md": history([".agents/harness.config.json", ".claude/skills/web-stack/", ...paths].join(", ")) });
const has = (lines, re) => assert.ok(lines.some((l) => re.test(l)), `expected a line matching ${re} in:\n${lines.join("\n")}`);

test("HARN-05 a clean generated adapter beside unrelated owner content exits 0", async () => {
  const r = lint({ files: { ".claude/commands/deploy.md": "owner command\n", ".claude/skills/owner-thing/SKILL.md": "no front matter\n", ".claude/skills/owner-thing/README.md": "x\n" } });
  assert.deepEqual(r.fails, []);
  const res = await runPh(["harness", "lint"], { root: r.root });
  assert.equal(res.code, 0);
  assert.match(res.out.at(-1), /^lint: 0 failed, \d+ warnings \(\d+ files checked\)$/);
  const all = lintProject(r.root, { all: true }).findings;
  assert.ok(all.some((f) => f.level === "warn" && f.file === ".claude/skills/owner-thing/README.md" && /^advisory: /.test(f.msg)));
  assert.ok(all.every((f) => f.level === "warn"));
});

test("HARN-05 a 501-line SKILL.md, an unlisted 301-line reference, a README and an agent without description each fail", async () => {
  const long = SKILL + "line\n".repeat(501);
  const r = lint({
    files: {
      ".claude/skills/web-stack/SKILL.md": long,
      ".claude/skills/web-stack/references/big.md": "# Big\n" + "x\n".repeat(301),
      ".claude/skills/web-stack/README.md": "readme\n",
      ".agents/agents/web-coder.md": "---\nname: web-coder\nmodel: standard\n---\nBody\n",
      ...inScope([".agents/agents/web-coder.md"]),
    },
  });
  has(r.fails, /SKILL\.md: SKILL\.md has \d+ lines \(> 500\)/);
  has(r.fails, /references\/big\.md: reference has 302 lines \(> 300\) and no contents list/);
  has(r.fails, /README\.md: README, CHANGELOG and INSTALLATION files do not belong/);
  has(r.fails, /web-coder\.md:1: front matter has no description/);
  const res = await runPh(["harness", "lint"], { root: r.root });
  assert.equal(res.code, 2);
});

test("HARN-05 description without a use-when trigger, extra agent keys, commands files and usage errors", async () => {
  const r = lint({
    files: {
      ".claude/skills/web-stack/SKILL.md": SKILL.replace("Use when writing or changing code under src/.", "Covers the stack."),
      ".agents/agents/web-coder.md": "---\nname: web-coder\ndescription: codes\ncolor: red\ntools: Read, Write\n---\nBody\n",
      ".claude/commands/gen.md": "generated\n",
      ...inScope([".agents/agents/web-coder.md", ".claude/commands/gen.md"]),
    },
  });
  has(r.fails, /description states no 'use when' trigger/);
  has(r.fails, /front matter key color is not allowed/);
  has(r.fails, /\.claude\/commands\/gen\.md: generated file under \.claude\/commands\//);
  has(r.warns, /tools lists Write but not Edit/);
  const res = await runPh(["harness", "check"], { root: r.root });
  assert.equal(res.code, 1);
  assert.match(res.err[0], /^usage error: /);
});

test("HARN-06 operational primitives fail, bare mentions warn, clock use in scripts fails", () => {
  const r = lint({
    files: {
      ".agents/agents/messenger.md": "---\nname: messenger\ndescription: relays\n---\nCall SendMessage(to: x) when done.\n",
      ".agents/agents/lister.md": "---\nname: lister\ndescription: lists\ntools: Read, TaskList\n---\nBody\n",
      ".claude/skills/web-stack/SKILL.md": SKILL + "\nNever use SendMessage; the leader relays. Do not broadcast.\n- Use TaskCreate to track work.\nteam_name: crew\n",
      ".agents/workflows/run.js": "export const meta = { name: 'run', description: 'd' }\nconst t = Date.now()\nreturn t\n",
      ...inScope([".agents/agents/messenger.md", ".agents/agents/lister.md", ".agents/workflows/run.js"]),
    },
  });
  has(r.fails, /messenger\.md:5: operational use of the in-session primitive SendMessage\(/);
  has(r.fails, /lister\.md:1: tools lists the in-session primitive TaskList/);
  has(r.warns, /SKILL\.md:\d+: mentions SendMessage/);
  has(r.warns, /SKILL\.md:\d+: mentions broadcast/);
  has(r.fails, /SKILL\.md:\d+: instruction to use the in-session primitive TaskCreate/);
  has(r.fails, /SKILL\.md:\d+: team_name is set/);
  has(r.fails, /run\.js:2: Date\.now\(\) breaks resume/);
  assert.ok(!r.fails.some((l) => /mentions SendMessage|Never use SendMessage/.test(l) && /SKILL/.test(l)));
});

test("HARN-07 unknown agent types, missing adapter scripts and an invalid adapter fail", () => {
  const r = lint({
    files: {
      ".agents/workflows/qa.js": "export const meta = { name: 'qa', description: 'd' }\nconst x = await agent('check', { agentType: 'qa-inspector' })\nreturn x\n",
      "tools/adapter/resolve-test.mjs": null,
      ...inScope([".agents/workflows/qa.js"]),
    },
  });
  has(r.fails, /qa\.js:2: agent type qa-inspector has no \.agents\/agents\/qa-inspector\.md/);
  has(r.fails, /adapter\.verify_vocabulary\.test\.resolver: script tools\/adapter\/resolve-test\.mjs does not exist/);
  const bad = cleanAdapter().overlay;
  bad.adapter.unknown_x = 1;
  const r2 = lint({ overlay: bad });
  has(r2.fails, /harness\.config\.json: invalid harness config adapter\.unknown_x: unknown key/);
  const missingSkill = cleanAdapter().overlay;
  missingSkill.adapter.stack_skill = "nope";
  has(lint({ overlay: missingSkill }).fails, /adapter\.stack_skill nope: no \.claude\/skills\/nope\/SKILL\.md/);
});

test("HARN-08 a concrete model id in an agent file and a role without reason fail", () => {
  const overlay = cleanAdapter().overlay;
  overlay.gsd.roles.checker = { model: "circle/some-model", effort: "high" };
  const r = lint({
    overlay,
    files: { ".agents/agents/web-coder.md": "---\nname: web-coder\ndescription: codes\nmodel: circle/x\n---\nBody\n", ...inScope([".agents/agents/web-coder.md"]) },
  });
  has(r.fails, /web-coder\.md:1: model circle\/x is a concrete model id/);
  has(r.fails, /gsd\.roles\.checker: no reason/);
  assert.ok(!r.fails.some((l) => /gsd\.roles\.executor/.test(l)));
});

test("HARN-09 eval records follow the exact schemas", () => {
  assert.notDeepEqual(validateEvalRecord("grading.json", { expectations: [{ name: "x", met: true, details: "d" }], summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 } }), []);
  assert.deepEqual(validateEvalRecord("grading.json", { expectations: [{ text: "x", passed: true, evidence: "e" }], summary: { passed: 1, failed: 0, total: 1, pass_rate: 1 } }), []);
  assert.deepEqual(validateEvalRecord("eval_metadata.json", { eval_id: 1, eval_name: "n", prompt: "p", assertions: [] }), []);
  assert.deepEqual(validateEvalRecord("timing.json", { total_tokens: 10, duration_ms: 2300, total_duration_seconds: 2.3 }), []);
  assert.notDeepEqual(validateEvalRecord("timing.json", { tokens: 10, duration_ms: 2300, total_duration_seconds: 2.3 }), []);
  const r = lint({
    files: { "_workspace/iteration-1/eval-1/with_skill/grading.json": JSON.stringify({ expectations: [{ name: "x", met: true, details: "d" }], summary: {} }), ...inScope(["_workspace/iteration-1/"]) },
  });
  has(r.fails, /grading\.json: expectations\[0\]: unknown field name/);
});

test("HARN-10 a generated skill without a trigger record warns; an incomplete record fails", () => {
  has(lint({ files: { ".agents/skill-tests/web-stack/triggers.json": null } }).warns, /no trigger record \.agents\/skill-tests\/web-stack\/triggers\.json/);
  has(lint({ files: { ".agents/skill-tests/web-stack/triggers.json": triggers("web-stack", 5, 5) } }).fails, /needs 10 should-trigger and 10 near-miss requests \(has 5 and 5\)/);
  assert.deepEqual(validateTriggerRecord(JSON.parse(triggers("web-stack")), "web-stack"), []);
});

test("HARN-13 history rows need Date, Change, Scope, Reason, ISO dates in order and repo-relative scopes", () => {
  const ok = lintHistory(history(".claude/skills/web-stack/SKILL.md"));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.rows.length, 2);
  const emptyReason = lintHistory(history("a.md").replace("map-codebase done", ""));
  assert.ok(emptyReason.problems.some((p) => p.msg === "empty Reason"));
  const order = lintHistory(history("a.md", "| 2026-10-01 | Later | b.md | why | |\n"));
  assert.ok(order.problems.some((p) => /earlier than the row above/.test(p.msg)));
  assert.ok(lintHistory(history("C:/abs/x.md")).problems.some((p) => /is absolute/.test(p.msg)));
  assert.ok(lintHistory("# none\n").problems.some((p) => /no history table/.test(p.msg)));
  has(lint({ files: { ".agents/harness-history.md": history("a.md").replace("2026-10-20", "2026-13-40") } }).fails, /harness-history\.md:\d+: date 2026-13-40 is not an ISO date/);
});

const ORCH = (body) => `---
name: web-orchestrator
description: "Coordinate the web review. Use when the user asks to review the web service."
---

# Web orchestrator

${body}`;

test("HARN-18 workflow scripts and orchestrator skills are checked mechanically", () => {
  const script = [
    "export const meta = { name: 'w', description: 'd', phases: [{ title: 'Collect' }] }",
    "phase('Collect')",
    "phase('Build')",
    "const all = await parallel([() => agent('a'), () => agent('b')])",
    "log(all.length)",
    "return all",
  ].join("\n");
  const mixed = ORCH("## Execution mode: Mixed\n\nRun `node .agents/harness/ph.mjs workflow --script s.js`.\n\n### Phase 1: Collect\n\n**Execution mode:** Workflow orchestration\n\n### Phase 2: Agree\n\nTalk.\n");
  const r = lint({
    files: {
      ".agents/workflows/w.js": script,
      ".agents/workflows/bad-meta.js": "export const meta = { name: makeName(), description: 'd' }\n",
      ".claude/skills/web-orchestrator/SKILL.md": mixed,
      ".agents/skill-tests/web-orchestrator/triggers.json": triggers("web-orchestrator"),
      ...inScope([".agents/workflows/w.js", ".agents/workflows/bad-meta.js", ".claude/skills/web-orchestrator/"]),
    },
  });
  has(r.fails, /w\.js:3: phase\('Build'\) has no entry in meta\.phases/);
  assert.ok(!r.fails.some((l) => /phase\('Collect'\)/.test(l)));
  has(r.warns, /w\.js:4: parallel\(\) result all is used as an array without a null guard/);
  has(r.fails, /bad-meta\.js:1: meta is not a pure literal/);
  has(r.fails, /web-orchestrator\/SKILL\.md:\d+: stage "Phase 2: Agree" of a mixed orchestrator has no \*\*Execution mode:\*\* label/);
  assert.ok(!r.fails.some((l) => /Phase 1: Collect/.test(l)));
  has(r.fails, /web-orchestrator\/SKILL\.md:\d+: orchestrator skill has no ## Test scenarios section/);
  const noMode = lint({
    files: {
      ".claude/skills/web-orchestrator/SKILL.md": ORCH("Run `ph fanout --file f`.\n\n## Test scenarios\n\n### Normal flow\nok\n### Error flow\nfails\n"),
      ".agents/skill-tests/web-orchestrator/triggers.json": triggers("web-orchestrator"),
      ...inScope([".claude/skills/web-orchestrator/"]),
    },
  });
  has(noMode.fails, /does not state its execution mode at the top/);
  assert.ok(!noMode.fails.some((l) => /Test scenarios/.test(l)));
  const guarded = lint({ files: { ".agents/workflows/w.js": script.replace("log(all.length)", "const ok = all.filter(Boolean)\nlog(ok.length)").replace("phase('Build')\n", ""), ...inScope([".agents/workflows/w.js"]) } });
  assert.ok(!guarded.warns.some((l) => /null guard/.test(l)));
  assert.ok(!guarded.fails.some((l) => /w\.js/.test(l)));
});
