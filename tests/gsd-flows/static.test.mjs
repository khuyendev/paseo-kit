// Static checks of the shipped GSD skills, scripts and overlays (text and structure).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { loadScript } from "./host.mjs";
import { kitHelpers } from "../../ship/.agents/harness/workflow/script.mjs";

const SKILLS = path.join(SHIP_DIR, ".claude", "skills");
const WF = path.join(SHIP_DIR, ".agents", "workflows");
// Line endings depend on the checkout (core.autocrlf on Windows); these checks compare text, not bytes.
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const skill = (name) => read(path.join(SKILLS, name, "SKILL.md"));
const SKILL_NAMES = ["gsd-map-codebase", "gsd-new-project", "gsd-discuss", "gsd-research", "gsd-plan", "gsd-execute", "gsd-verify", "gsd-quick", "gsd-progress", "gsd-pause", "gsd-undo", "gsd-forensics", "gsd-debug"];
const SCRIPTS = fs.readdirSync(WF).filter((f) => /^gsd-.*\.js$/.test(f));
const kitFiles = () => [
  ...SKILL_NAMES.map((n) => path.join(SKILLS, n, "SKILL.md")),
  ...SCRIPTS.map((f) => path.join(WF, f)),
  ...fs.readdirSync(path.join(WF, "lib")).map((f) => path.join(WF, "lib", f)),
  ...fs.readdirSync(path.join(WF, "lenses")).map((f) => path.join(WF, "lenses", f)),
  ...fs.readdirSync(path.join(WF, "overlays")).map((f) => path.join(WF, "overlays", f)),
  ...fs.readdirSync(path.join(WF, "prompts")).filter((f) => f.endsWith(".md")).map((f) => path.join(WF, "prompts", f)),
  path.join(WF, "gsd-overlay.md"),
];
// GSDC-50 deny list: no Backlog path and no project, engine or game vocabulary in kit-authored GSD files.
const DENY = /\b(backlog|unreal|unity|godot|wildera|blueprint|uasset|game ?engine)\b/i;
const parseMeta = (text) => {
  const m = /^\s*export const meta = (\{[\s\S]*?\n\});/.exec(text);
  return Function(`return (${m[1]})`)();
};

test("GSDF-01 no kit-authored GSD file instructs native Agent, Task or Workflow; every skill maps spawns to ph", () => {
  const native = /\b(Agent|Task|Workflow|TaskCreate|SendMessage)\s*\(|use the (native )?(Agent|Task|Workflow) tool/;
  for (const f of kitFiles()) assert.doesNotMatch(read(f), native, f);
  for (const n of SKILL_NAMES) {
    const text = skill(n);
    assert.match(text, /gsd-overlay\.md/, `${n} applies the common overlay`);
  }
  const overlay = read(path.join(WF, "gsd-overlay.md"));
  assert.match(overlay, /Every worker is a `ph` agent/);
  assert.match(overlay, /native subagent, task and workflow tools are never used/);
  assert.match(overlay, /quota, credit, billing, auth or permission is never retried/);
});

test("GSDF-02 plan chains execute and verify, --plan-only stops after the handoff, execute needs handoff files", () => {
  const plan = skill("gsd-plan");
  assert.match(plan, /chain: `gsd-execute`, then `gsd-verify`, stopping at the first `needs-owner` or `failed`/);
  assert.match(plan, /`--plan-only`: stop after the handoff/);
  // THIN stage 3: the handoff check is the kit step `load` that gsd-execute runs among its preconditions.
  assert.match(loadScript("gsd-execute"), /await R\.load\(\)/);
  assert.match(read(path.join(SHIP_DIR, ".agents", "harness", "workflow", "steps.mjs")), /no handoff files in/);
});

// THIN.md item 1: the one verb helper is the engine's (kitHelpers in workflow/script.mjs); no script carries a copy.
test("GSDF-03 scripts read no clock or randomness, share one verb helper and only validated phase dirs", () => {
  const helpers = String(kitHelpers);
  for (const f of SCRIPTS) {
    const text = read(path.join(WF, f));
    assert.doesNotMatch(text, /\bDate\b|Math\.random|ScheduleWakeup|setTimeout|\bsleep\(/, f);
    assert.doesNotMatch(text, /\/\/ ---- shared GSD script helpers|^async function run\(/m, `${f} carries no copy of the engine helpers`);
    const meta = parseMeta(text);
    assert.ok(meta.name === f.replace(/\.js$/, "") && meta.description, `${f} meta`);
  }
  assert.doesNotMatch(helpers, /\bDate\b|Math\.random/);
  assert.match(helpers, /PHASE_DIR_RE = \/\^\\\.planning\\\/phases\\\/\\d\+\(\\\.\\d\+\)\?-\[a-z0-9-\]\+\$\//);
  assert.match(helpers, /Input digest \(\$\{key\}\): \$\{hash\}/);
});

test("GSDF-04 scripts and skills name only roster agents; a shipped agent dir matches the roster", () => {
  const ROSTER = ["gsd-planner", "gsd-plan-checker", "gsd-phase-researcher", "gsd-executor", "gsd-verifier", "gsd-debugger", "gsd-codebase-mapper", "gsd-project-researcher", "gsd-research-synthesizer", "gsd-roadmapper", "gsd-code-reviewer", "gsd-code-fixer", "gsd-skeleton-reviewer", "gsd-map-reviewer", "finding-verifier"];
  for (const f of SCRIPTS) for (const m of read(path.join(WF, f)).matchAll(/"(gsd-[a-z-]+|finding-verifier)"/g)) {
    if (m[1].startsWith("gsd-") && SCRIPTS.includes(`${m[1]}.js`)) continue;
    assert.ok(ROSTER.includes(m[1]), `${f} names ${m[1]}`);
  }
  const agents = path.join(SHIP_DIR, ".agents", "agents");
  const shipped = fs.readdirSync(agents).filter((x) => x.endsWith(".md")).map((f) => f.replace(/\.md$/, "")).sort();
  assert.deepEqual(shipped, [...ROSTER].sort());
  for (const role of ["gsd-debugger", "gsd-phase-researcher", "gsd-roadmapper"]) {
    assert.match(read(path.join(agents, `${role}.md`)), new RegExp(`^  - \.agents/workflows/overlays/${role}\.md$`, "m"), `${role} includes its flow overlay`);
  }
  for (const f of kitFiles()) assert.doesNotMatch(read(f), DENY, f);
});

test("GSDF-07 new-project writes PROJECT/REQUIREMENTS itself, preferences to the gsd overlay, roadmap through the draft contract", () => {
  const t = skill("gsd-new-project");
  for (const s of ["What, Core Value, Requirements (Validated / Active / Out of Scope), Key Decisions, evolution footer", "`gsd` section of `.agents/harness.config.json`", "v1, v2 and Out of Scope", "1) approve, 2) adjust", "\"stage\": \"install\", \"approved\": true"]) assert.ok(t.includes(s), s);
});

test("GSDF-08 new-project decides by the initialization predicate and never nests git init", () => {
  const t = skill("gsd-new-project");
  assert.match(t, /never by `\.planning\/` existing/);
  assert.match(t, /gsd init\.project/);
  assert.match(t, /resume at the first missing artifact/);
  assert.match(t, /refuse with "already initialized; use gsd-progress"/);
  assert.match(t, /Never run `git init` inside an existing work tree/);
});

test("GSDF-10 discuss checkpoints, CONTEXT sections, stable D-NN ids, refused modes, STATE through the verb", () => {
  const t = skill("gsd-discuss");
  for (const s of ["DISCUSS-CHECKPOINT.json", "`<domain>`, `<decisions>`", "`<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`", "- **D-NN:** text", "last 3 CONTEXT files", "an empty reply is not approval", "`--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`", "gsd state position", "No git step.", "DISCUSSION-LOG.md"]) assert.ok(t.includes(s), s);
});

test("GSDF-13 research skill modes: view without agent, refresh, default reuse; never continues to planning", () => {
  const t = skill("gsd-research");
  for (const s of ["`--view`", "no agent", "`--refresh [focus]`", "offer `--refresh` instead of researching silently", "never turn it into a locked decision", "Standalone research ends here"]) assert.ok(t.includes(s), s);
});

test("GSDF-35 the plan script runs no git branch command and keeps researcher, planner and checker apart", () => {
  const s = loadScript("gsd-plan");
  assert.doesNotMatch(s, /"git"|checkout|switch|branch -/);
  assert.match(skill("gsd-plan"), /first phase .* whose status is `NOT_STARTED`/);
  assert.match(s, /gsd-plan-checker/);
  assert.doesNotMatch(s, /gsd-phase-researcher/);
});

test("GSDF-57 UAT conversation rules", () => {
  const t = skill("gsd-verify");
  for (const s of ["pass (empty, yes, y, ok, next)", "infer `blocked_by`", "infer severity; never ask", "Deferred follow-ups never become gaps", "after each issue, every 5 passes and at completion", "phase uat-passed <N> --require-verification", "adapter.startup_globs", "`commits.json` entry and a current gate evidence file", "`gap_ids`", "no issue unless every `## Gaps` entry for it is a verified resolution"]) assert.ok(t.includes(s), s);
});

test("GSDF-58 transition evolves PROJECT.md and never closes milestones", () => {
  const t = skill("gsd-verify");
  assert.match(t, /move shipped Active requirements to Validated, update Key Decisions, stamp the last-updated footer/);
  assert.match(t, /Never close a milestone/);
});

test("GSDF-59 progress routes Route 0 first and next adds hard stops", () => {
  const t = skill("gsd-progress");
  for (const s of ["0. Scan every phase, lowest first", "not `complete` is reported as failed", "partial UAT", "`gaps_found`", "Summaries < plans", "`.planning/.continue-here.md`", "STATE status not in the lifecycle vocabulary", "invalid VERIFICATION"]) assert.ok(t.includes(s), s);
});

test("GSDF-60 pause writes the handoff and a STATE note; resume restores from files and removes it after confirmation", () => {
  const t = skill("gsd-pause");
  for (const s of ["`.planning/.continue-here.md`", "gsd state session-note", "Nothing comes from memory", "after the confirmation remove"]) assert.ok(t.includes(s), s);
});

test("GSDF-62 undo uses select-revert-commits, refuses shared wave commits for a plan, reverts without reset", () => {
  const t = skill("gsd-undo");
  for (const s of ["select-revert-commits", "`shared: true`", "name the sibling plans", "types `revert`", "git revert --no-commit", "never `git reset`", "usage: gsd-undo --last N | --phase NN | --plan NN-MM"]) assert.ok(t.includes(s), s);
});

test("GSDF-63 forensics is read-only, dated report, labelled hypotheses, one STATE note exception", () => {
  const t = skill("gsd-forensics");
  for (const s of ["no agent, no workflow, no build, no test", "GitHub-issue step", "without a persistent hypothesis record", "forensic hypothesis, not debugger-confirmed", "cut at 50 lines", "no home or absolute paths", "gsd state session-note", "`git status` shows only the report"]) assert.ok(t.includes(s), s);
});

test("GSDF-66 debugger overlay carries each rule sentence", () => {
  const t = read(path.join(WF, "overlays", "gsd-debugger.md"));
  for (const s of ["Update the session file before acting", "never change `## Symptoms`", "never \"continue investigating\"", "never edit a shared file", "remove every piece of instrumentation", "Never weaken an assertion, enlarge a tolerance, lengthen a wait or re-press inputs", "named spec line or an owner decision", "already present in the tree before the session", "Never commit, stage or stash", "`human-verify` checkpoint with a prevention block", "MemPalace, specialist skills and TDD mode are off"]) assert.ok(t.includes(s), s);
});
