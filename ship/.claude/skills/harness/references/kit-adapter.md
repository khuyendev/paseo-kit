# Kit overlay — the harness generates the project adapter

This file is the paseo-kit's adapter layer for the `harness` and `harness-evolve` skills. The method in `SKILL.md`
and the other references is carried unchanged; this overlay says what the method produces in this kit and the
kit's rules for it. Where the two differ for a kit project, this overlay wins.

## Contents

1. [What the harness output is for](#1-what-the-harness-output-is-for)
2. [When to run](#2-when-to-run)
3. [Inputs](#3-inputs)
4. [The adapter sections](#4-the-adapter-sections)
5. [Adapter scripts](#5-adapter-scripts)
6. [Stack skill and project agents](#6-stack-skill-and-project-agents)
7. [Model tiers and roles](#7-model-tiers-and-roles)
8. [Lint](#8-lint)
9. [Trigger tests and eval records](#9-trigger-tests-and-eval-records)
10. [History row, report and confirmation](#10-history-row-report-and-confirmation)
11. [Evolve](#11-evolve)

## 1. What the harness output is for

The kit ships a generic GSD core (plan, execute, verify, debug) that knows nothing about any project. The harness
fills that gap: it reads the codebase map and writes the **project adapter**, the project data the GSD core, the
GSD flows and the kit hooks read by name. The adapter is:

- the `adapter` and `gsd` sections of `.agents/harness.config.json` (plus the `tiers` the roles use);
- one stack skill in `.claude/skills/<stack>/` (how to write code in this stack);
- project agents in `.agents/agents/`, only where a kit GSD agent is not enough;
- the scripts the adapter names (verify resolvers, parsers, checkers).

The method's steps still guide the work: step 0 (inspect what exists), the role-vs-skill split, the overlap checks
before any new agent or skill (step 3, step 4-0), model choice (step 3), skill writing (step 4) and testing
(step 6), and the history table (step 7). Building a generic agent team is not a kit goal; do it only when the owner
asks for one.

## 2. When to run

- After `gsd-map-codebase` wrote `.planning/codebase/*.md`, before `gsd-new-project` plans anything.
- When the owner asks to generate, regenerate or extend the adapter (a new language, a new test runner).
- Lessons from runs and feedback on an existing adapter go to `harness-evolve` (section 11).

## 3. Inputs

- `.planning/codebase/*.md`: STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS.
- `node .agents/harness/ph.mjs config`: the effective adapter and its sources (kit defaults are neutral).
- `.agents/agents/` (the kit's GSD agents and any project agents), `.claude/skills/`, `CLAUDE.md`, `AGENTS.md`.
- `.agents/harness-history.md` (earlier adapter changes and their reasons).
- The code itself: run the build and test commands you intend to write before writing them.

## 4. The adapter sections

Write each entry you set **whole**: an overlay entry replaces the kit default entry entirely, and closed
validation names any missing nested key (ADPT-14). Omit an entry to keep the kit default. Every command is an argv
array run without a shell from the code root (`["npm", "test"]`, never `"npm test"`).

| Entry | ID | What to write |
| --- | --- | --- |
| `adapter.commands` | ADPT-02 | `{build, test, build_timeout_s, test_timeout_s, gates: [{name, argv}], verify: {<runner>: {argv, timeout_s}}}`; `build`/`test` are argv or `null` (a null command is reported `not configured` and never counts green); verify runners may use the placeholders `{argument}` and `{targets}` (each target one argv element) |
| `adapter.verify_vocabulary` | ADPT-03 | `{<kind>: {prefix, parser, resolver, runner, evidence_parser, exit_code_sufficient}}`: the `<automated>` obligation kinds plans may use (for example `test:` naming test filters); keep the default `build` and `cmd:` kinds; give every new kind a resolver (does the target exist), a runner (a key of `commands.verify`) and an evidence parser (how many targets really ran) unless its exit code alone is proof |
| `adapter.ownership` | ADPT-04 | `{owns_forms: [{prefix, maps_to}], shared: {globs, predicate}, source_roots, ignore}`: how plans name the files they own, which files are shared (lock files, generated registries), where source lives, and `ignore`: globs of paths the owner or the orchestrator edits while gsd-execute runs (notes, feedback logs), which neither the safe-resume gate nor the commit check counts as plan output (default empty) |
| `adapter.review_lenses` | ADPT-05 | `[{name, text, stage, applies_to}]`: code-review lenses for this stack (stage `code`, `skeleton` or `plan_review`; `applies_to` globs); none = the kit lens `correctness` |
| `adapter.syntax_checkers` | ADPT-06 | `{".ext": {argv, timeout_s, max_parallel}}`: a fast checker per file extension; it gets the file path as its last argument, prints `file:line:col: message` and exits non-zero on a syntax error |
| `adapter.instructions` | ADPT-07 | repo-relative instruction files (coding rules, layout) every planner, checker and executor reads |
| `adapter.envelope` | ADPT-08 | optional `[{axis, values or range, source}]`: the operating envelope a fix is judged against (platforms, sizes, versions) |
| `adapter.stack_skill`, `adapter.agents` | ADPT-09 | the stack skill's folder name; GSD role -> project agent type, only for roles a project agent replaces (`architect` enables the wiring stage) |
| `adapter.mutex` | ADPT-10 | optional machine-wide lock name for heavy commands (one build at a time across worktrees) |
| `adapter.startup_globs`, `adapter.hook_timeout_s`, `adapter.attribution` | ADPT-13 | files whose change needs a cold-start smoke test; adapter script timeout; optional failure-attribution script |
| `adapter.worktree_setup` | ADPT-13 | `{copy: [path], link: [path]}`: git-ignored paths (dependency folders such as `node_modules`, `.venv` or `vendor`, local generated files) that every new harness worktree gets from the checkout before its agent starts, because `git worktree add` checks out tracked files only. `copy` gives each worktree its own copy (slow for a large folder); `link` takes directories only and makes a junction (a symlink on POSIX) to the checkout's folder: fast, but an install inside the worktree changes the checkout. Set it when `gsd.isolation` is `worktree` (or agents use `--worktree`) and the build or tests need such a path; each path must exist in the checkout and be git-ignored |
| `gsd.roles` | ADPT-11 | `{<role>: {model, effort, reason}}` for the roles whose model or effort differs from the agent definition; a non-empty `reason` on every entry |
| `gsd.granularity`, `gsd.plan_limits` | ADPT-12 | plan size for this codebase; split plans for real reasons (overlapping owns in one wave, an ordering coupling, a gating spike, a plan too big for one coder context) |
| `gsd.code_review` | ADPT-13 | `{max_concurrent, reviewers: [{model, effort}]}`: how gsd-execute reviews the plans of a wave. `max_concurrent` plans are reviewed at once (kit default 1, one after another; reviewers only read, so more is safe and saves wall time). `reviewers` empty = one reviewer per plan with `gsd.roles.reviewer`; each entry adds an independent reviewer of every plan with its own model (a tier or model id) and effort, both optional. Their findings are not merged: ids of the second reviewer start `R2-`, and one defect found by two reviewers counts twice. Each reviewer is one more agent per plan; the owner decides per project |
| other `gsd` keys | ADPT-13 | `execution_mode`, `isolation`, `commit_policy`, `branching`, `protected_branches`, `requirement_id_regex`, `research`, `plan_review`, `skeleton_lanes`, loop bounds, `debug`, `fixer`, `parallelization`, `review_depth`: set only what the project needs to differ |
| `tiers` | CONF-11 | the shipped tiers are unconfigured; set `frontier`, `pro` and `standard` to `circle/<model>` with the owner's choice of models |

Writing a review lens (`review_lenses[].text`; the rules of good review guides in the Claude Code team's review
write-up, owner decision 2026-10-22). A lens is read on every review of the files it applies to, so it states what
the reviewer cannot infer and nothing else:
- What failure looks like in these files, in the project's terms: for docs "it states something false", for config
  "it routes or enables the wrong thing", for a parser "it accepts input the format forbids". Not a generic list of
  bug kinds; the kit lens `correctness` already covers those.
- The paths or generated parts inside `applies_to` that the lens ignores, and why.
- Evidence: a file and line that shows the failure, not a guess from a name.
- No style, naming or nit findings unless the project asks for one kind; a lens that wants them caps them at a few
  per review and keeps them below `medium`.
- One lens per failure area; split a lens whose findings land on unrelated files.
The review already marks findings outside the plan's changed lines as pre-existing (deferred, never blocking), asks
for one finding per defect class with its instances, and sends uncertain verdicts to a second verifier; a lens does
not repeat those rules.

Example (a Node web service):

```json
{
  "tiers": {
    "frontier": {"provider": "circle/<strongest model>", "thinking": "high"},
    "pro": {"provider": "circle/<strong model>", "thinking": "high"},
    "standard": {"provider": "circle/<fast model>", "thinking": "low"}
  },
  "adapter": {
    "commands": {"build": ["npm", "run", "build"], "test": ["npm", "test"], "build_timeout_s": 300,
      "test_timeout_s": 600, "gates": [], "verify": {"jest": {"argv": ["npx", "jest", "{targets}"], "timeout_s": 600}}},
    "verify_vocabulary": {
      "build": {"prefix": "build", "parser": null, "resolver": null, "runner": null, "evidence_parser": null, "exit_code_sufficient": true},
      "cmd": {"prefix": "cmd:", "parser": null, "resolver": null, "runner": null, "evidence_parser": null, "exit_code_sufficient": true},
      "test": {"prefix": "test:", "parser": null, "resolver": "tools/adapter/resolve-test.mjs", "runner": "jest",
        "evidence_parser": "tools/adapter/jest-evidence.mjs", "exit_code_sufficient": false}
    },
    "syntax_checkers": {".js": {"argv": ["node", "--check"], "timeout_s": 20}},
    "stack_skill": "node-service"
  },
  "gsd": {"roles": {"executor": {"model": "pro", "effort": "medium", "reason": "multi-file structural changes in src/"}}}
}
```

## 5. Adapter scripts

Scripts the adapter names (resolver, parser, evidence parser, shared predicate, attribution) are project files,
usually under a project folder such as `tools/adapter/`. The core runs them without a shell: a `.mjs`/`.js` path
with the current node, any other path directly; cwd = the code root; timeout `adapter.hook_timeout_s`. The request
is one JSON object on stdin `{v: 1, op, codeRoot, phaseDir?, ...}`; the response is one JSON line on stdout
`{v: 1, ...}`:

| `op` | request fields | response |
| --- | --- | --- |
| `parse` | `kind, argument` | `{targets: [string]}` |
| `resolve` | `kind, targets, plan, filesModified` | `{results: [{target, status: ok\|pending_creation\|missing\|unresolvable, detail?}]}` |
| `shared` | `paths` | `{shared: [path]}` |
| `evidence` | `kind, argument, targets, exitCode, stdoutPath, stderrPath` | `{executed: {count, targets}, failed: [string], outcome: passed\|failed\|unavailable}` |
| `attribute` | `failures: [{text, file?}], plans: [{id, owns}]` | `{assignments: [{failure, plan\|null}]}` |

A non-zero exit, a timeout, another `v`, a missing field or unparsable output counts as `unresolvable`, never as a
pass. An evidence parser must report how many targets really ran: a test runner that exits 0 after running
nothing is a failure, not a pass.

### Stable target identities (ADPT-03/15/17)

Choose one canonical target identity scheme and document it in the generated stack skill. The parser's targets,
resolver's results, runner selection and `executed.targets` must use those exact identities end to end (including
path separators, case and disambiguation of repeated test names). A positive count alone proves no named target.

- Normalize file/suite/alias selectors to a nonempty set of concrete IDs in the **parser**, before execution,
  using project discovery. The resolver validates each ID unchanged; its closed response cannot rename or expand
  targets. Use `{targets}` in runner argv when running the normalized set; do not reselect from the original
  `{argument}` in a way that changes that set. Unknown/empty selectors must fail closed, not fall back to all.
- Alternatively retain a file or suite ID only when runner output proves that selection completed and maps its
  actual executed members to that ID. The evidence parser must require that completion/membership proof, not
  merely a global count or one matching member. Retain the raw runner mapping in the logs. If the runner cannot
  provide it, normalize in the parser instead. Discovery alone is not execution evidence.
- `executed.targets` comes from actual completed runner records, never by copying the request or adding every
  requested name. Skipped, filtered-out, missing and unstarted cases are not executed. `count` is the actual
  executed-case count, not necessarily the number of selector IDs. Failed runners cannot pass. Do not set
  `exit_code_sufficient: true` to bypass target coverage for tests.

### Mandatory protocol self-check before readiness

Lint is structural and never executes build commands. Separately, with permission to run the project commands,
run the declared build/test commands and an end-to-end check of **every documented selector form**:

```text
node .agents/harness/adapter/check.mjs --kind <kind> --command "<prefix><selector>" --run
```

This explicit opt-in runs parser -> resolver -> runner -> evidence and applies the gate's `executionProblem`
coverage rule. It retains `check.json`, stdout and stderr in a fresh `_workspace/adapter-check/check-*` directory
(`--output <dir>` changes the parent). Exit 0 = this obligation passed, 2 = rejected, 1 = usage/config/error.
It is not a full GSD gate and cannot certify an evidence parser that invents runner facts.

Before reporting ready, write/run a project-owned self-check that asserts independently known expected IDs and
counts, not expected values copied from the parser. Cover an exact single target, a multi-test file and every
advertised suite alias; where a form is unsupported, assert its rejection and do not document it as supported.
In an isolated fixture exercise zero execution, one missing executed member, a failed runner, and an unknown
selector. Assert rejection and inspect raw runner records; for unknown/missing resolution assert no runner ran.
Use controlled runner output for failure injection only, label it synthetic, and keep real positive runs separate.
Preserve commands, exit codes, expected/resolved/executed IDs, counts and log paths. If any check fails or cannot
run, report the adapter **not ready**, with the blocker; a lint pass or trigger score does not waive this check.

## 6. Stack skill and project agents

- Write one stack skill `.claude/skills/<stack>/SKILL.md`: how to write, build and test code in this stack, the
  project's conventions from `CONVENTIONS.md`, and the traps from `CONCERNS.md`. Executor and fixer prompts tell
  the agent to follow it. Follow the skill-writing guide (description with "use when" triggers, body under 500
  lines, details in `references/`).
- Give the stack skill a `## Gotchas` section and put the most effort there (owner decision 2026-10-22, after the
  Claude Code team's skills write-up: the highest-signal part of a skill): each gotcha is a trap of this codebase an
  agent fell into or would fall into, stated as the fact and what to do instead ("the `subscriptions` table is
  append-only: the current row has the highest version, not the latest `created_at`"). Leave out what an agent
  learns by reading the code or knows by default. `harness-evolve` adds a gotcha when the same failure repeats.
- Write every skill description as when to trigger, not a summary, and name the owner's own wording in English and
  in the owner's language (`Trigger on: 'run the tests', 'chạy test'`). Quote the description when it holds `: `, or
  the front matter stops being YAML and the skill is listed without it. `ph evolve-stats` lists every project skill
  with the times the model invoked it (`_workspace/skill-usage.jsonl`, written by the kit's skill usage hook); a
  skill at 0 calls after it should have fired needs a better description.
- Reuse the kit's GSD agents in `.agents/agents/` (`gsd-executor`, `gsd-code-reviewer`, `gsd-code-fixer`,
  `gsd-verifier` and the others) before creating any agent. A project agent is justified only when a role needs
  knowledge or tools the stack skill cannot give the generic agent (for example an interface architect for a
  codebase with a wiring layer); map it in `adapter.agents`.
- Agent front matter keys: `name`, `description`, `tools` (advisory), `model` (a tier), `include` (repo-relative
  files loaded into the prompt). Nothing else.

## 7. Model tiers and roles

Coding work reads the tiers this way (D-59): **standard** = coding with a clear procedure (a known pattern, a
mechanical change, a fix with a stated cause); **pro** = multi-step structural coding (design, cross-module
changes, review, verification); **frontier** = planning and long autonomous work that changes its plan from
results. Agent files name only a tier in `model:`. Concrete model ids appear only in `tiers` and in `gsd.roles`
entries, each with a non-empty `reason`.

Keep model, effort and Fast on/off together in each tier: `tiers.<name>.provider`, `thinking`, and
`features.fast_mode` (a JSON boolean). When the owner changes a tier, patch those requested fields in the project
`.agents/harness.config.json`, preserving its other fields and unrelated settings. Batch changes to several tiers
in one edit and validate once. Do not rewrite kit defaults or provider settings, and do not create duplicate
`pro-fast` / `pro-slow` tiers merely to toggle Fast.

By default, generated `gsd.roles.<role>.model`, workflow agent calls and spawn commands reference tier names,
not concrete model IDs; a per-role concrete-model exception needs the owner's explicit instruction. Then an owner
request such as "pro, medium, Fast off" changes one mapping, not every workflow. `--model pro` and
`agent(..., {model: "pro"})` receive that tier's features; a direct `--model circle/<model>` bypasses the tier
and does not inherit its Fast setting. Explicit effort overrides remain independent.

One kit default sits outside the tiers: `gsd-execute` runs the code fixer (`fixer` role) at effort `high` on its own
tier's model, because it repairs confirmed defects and failed checks in existing code, where more effort finds the
edge cases the tests miss. A project's `gsd.roles.fixer.effort` replaces it; `gsd.roles.fixer.model` alone keeps it.

For example, a configured tier entry can be:

```json
{"provider": "circle/<fast-capable model>", "thinking": "medium", "features": {"fast_mode": true}}
```

Use `false` for Fast off; do not replace the model with a differently named `*-fast` model to simulate this toggle.
Fast is independent of bypass permissions and only works for provider/model combinations that advertise it.
Changing tiers affects subsequently created agents/new workflow launches, not already-running agents or workflows;
a cached resume may create no agent at all. Leave the kit's shipped tiers unconfigured until the project or owner
chooses their models.

## 8. Lint

`node .agents/harness/ph.mjs harness lint` checks what the harness generated: the files listed in the Scope of the
latest history row written by the harness or harness-evolve, and every skill, agent and script the adapter names.
It fails (exit 2, one line per finding) on: an adapter that fails closed validation; a named agent, skill or
script that does not exist; skill front matter without `name` or a `description` with a "use when" trigger; a
SKILL.md over 500 lines; a reference over 300 lines without a contents list; a README, CHANGELOG or INSTALLATION
file in a skill folder; a generated file under `.claude/commands/`; agent front matter without `name` or
`description` or with other keys; a concrete model id in an agent file; a role entry without `reason`; a
`worktree_setup` path that is malformed, overlapping, missing from the checkout, a link or not git-ignored; operational
use of in-session primitives (`Agent(`, `Workflow(`, `SendMessage(`, `Task*`, `TeamCreate`, `TeamDelete`, team
flags); workflow scripts with `Date.now()`, `Math.random()` or a non-literal `meta`, `phase()` titles missing from
`meta.phases`; orchestrator skills without an execution mode at the top, an unlabelled stage of a mixed one, or no
`## Test scenarios` with a normal and an error flow; malformed history rows and eval records. Warnings (exit 0):
bare mentions of primitives, an agent with Write but not Edit, unguarded `agent()`/`parallel()` results used as
arrays, a generated skill without a trigger record. `--all` also reports other owner content, as warnings only.
Fix every failure before reporting; never change provider settings to satisfy lint.

The semantic checks of the method (stage inputs and outputs connect, mode handoffs, a dry run, step 6-5) stay
manual: record that you did them in the history row's Change cell.

## 9. Trigger tests and eval records

Every project skill the harness generates gets a trigger test: 10 requests that should invoke it and 10 near
misses (step 6-4), each run in a fresh agent (`ph fanout --collect` or a workflow; inspect `skills` in the result
JSON) on `circle/gpt-6-luna-fast[1m]` unless the owner names another model. Record it in
`.agents/skill-tests/<skill>/triggers.json`:

```json
{"skill": "node-service", "date": "2026-10-20", "model": "circle/gpt-6-luna-fast[1m]",
 "requests": [{"text": "...", "should_trigger": true, "triggered": true}],
 "precision": 1.0, "recall": 0.9}
```

and put precision and recall in the history row. With-skill versus baseline runs and the blind A/B workflow of the
skill-testing guide stay optional; when you run them, the records follow the guide's exact field names:
`eval_metadata.json {eval_id, eval_name, prompt, assertions}`, `grading.json {expectations: [{text, passed,
evidence}], summary: {passed, failed, total, pass_rate}}`, `timing.json {total_tokens, duration_ms,
total_duration_seconds}`.

## 10. History row, report and confirmation

Append one row per change to `.agents/harness-history.md`, newest last:

```markdown
| Date | Change | Scope | Reason | Supersedes |
|------|--------|-------|--------|------------|
| 2026-10-20 | Generate adapter (node-service stack skill, jest test kind) | .agents/harness.config.json, .claude/skills/node-service/SKILL.md, tools/adapter/resolve-test.mjs | map-codebase done; first adapter; triggers p=1.0 r=0.9 | |
```

Date is ISO (`YYYY-MM-DD`) and never earlier than the row above; Scope lists repo-relative paths separated by
commas (lint checks exactly these files); Supersedes names the earlier row's date and change when this row undoes
it, else stays empty.

Then report to the owner, in the owner's language: what was written (each adapter entry, the stack skill, any
agent and script), the commands you ran and their results, the lint result, protocol self-check results and evidence paths, and what you could not decide. Ask
the owner to confirm before any GSD flow relies on the adapter. Files the harness writes (adapter, skills, agents,
history rows) are in English whatever language the owner uses.

## 11. Evolve

`harness-evolve` evolves the adapter the same way the method evolves a harness. Its sources in this kit:
`.agents/harness-history.md`; `git log` of `.agents/`, `.claude/`, `AGENTS.md` and `CLAUDE.md`; run records
`_workspace/_runs/*/run.json` and the `null` reasons in `journal.jsonl`; `ph review-stats` (the code review measured from
each phase's `review/*.json` records and the fates recorded with `ph review-stats outcome`); and each phase's
`.planning/phases/<NN>-<slug>/deferred.md`. Map each lesson to the adapter part
it touches (a verify kind that keeps failing to resolve -> its resolver; repeated review findings of one kind -> a
review lens or the stack skill; a gate that is slow -> `commands` timeouts or `mutex`). Apply one change at a time,
run lint, re-run at least 3 + 3 trigger requests when a skill description changed, and append a history row.

Measure before you change, and say what was measured. `_workspace/harness-metrics.jsonl` keeps one line per ended
workflow run (it survives `ph runs --prune`); `ph evolve-stats --import` adds older runs from `_workspace/_runs/`, and
`ph evolve-stats [--agent A] [--workflow N] [--since DATE]` prints one line per agent version (agent, role-text hash,
model, effort: calls, ok, `null` split into agent, infra and other causes, median seconds, cost per call, the results
of its runs) and one line per workflow (results such as `passed`/`gaps_found`, gaps, wall time, cost per run, and a
suggested `ph workflow --budget` of 4 x the median output tokens of a run: a cap that stops a runaway run, not a
normal one; tighten it once there are real numbers), with the stopped runs counted by their `ph archive --run
--reason`; stops without a reason are counted too and teach nothing. A review lens or review rule change is measured
with `ph review-stats`: the share of gated findings the verifier confirms and of deferred findings later judged real,
per likelihood; record the fate of a deferred finding when it is settled, or the deferred side measures nothing.
- Sort every failure by cause before editing anything; a lesson is a cause shared by several failures, not one
  failure. Infra `null`s (daemon, provider, caps, permissions) and a grader or check that contradicts its own task are
  fixed in the runtime, the check or the task, never in role text.
- An edit to an agent definition changes its role-text hash, so `evolve-stats` shows the old and the new version on
  separate lines. Compare them only when each side has at least 5 runs (fewer are marked `few runs`); a difference that
  one or two runs could flip is noise, not a gain. Judge on runs the change was not tuned on (later runs, other phases),
  and revert a change that helps only the runs that prompted it.
- When outputs are stable and failures are rare, target cost at the same results: a lower tier or effort for one role
  (section 7) is a cheap, attributable change; check it with the same comparison.
- End the Reason cell of the history row with `measured: <agent> <old hash> -> <new hash>, <numbers before> ->
  <numbers after>` or with `not measured (<why>)`; never call an unmeasured change an improvement.
Lessons that apply to every project go back to the kit with `node <kit>/kit.mjs pull <project> <files> --kit
<kit dir>`.
