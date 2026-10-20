# Review r1: GSD plan/research/verify adapter (GSP)

## Verdict

REVISE. 1 BLOCKER, 7 MAJOR, 6 MINOR. The stage machine (outline, wiring, skeleton, per-plan planners, checker, handoff, research readback, verification readback) is largely faithful to `gsd.mjs` and the three workflows, and many non-obvious rules (exit 69, attempt-before-dispatch, digest-in-prompt, tracer split, stall, force-proceed missing) are real. The spec would still be wrong in two places that change a contract: the latest owner plan-size correction is not in the map, and several cited ROADMAP lines do not exist. Gap-mode scope, the wiring realign rule, the snapshot file list, and the checker conflict rule are also wrong or incomplete.

## Findings

### R1-GSP-01 BLOCKER coverage Latest owner plan-size correction is missing
- Severity: BLOCKER
- Category: coverage
- Map entry: missing (GSP-60 / GSP-38 only carry the earlier D-14 "more, smaller plans" rule)
- Evidence: wildera:.planning/STATE.md:163-164. Coverage table says STATE.md is 162 lines and read fully. The file is 164 lines. Line 163: owner called the 85-plan/8-wave Phase 1.1 outline "overthinking"; run stopped at Plan; CONTEXT D-16 added ("about 15-20 plans, at most 4 waves, scope unchanged"); replan with `granularity` coarse (Phase 01 args had been "fine") and 4 skeleton lanes, integration lens carries D-16. Line 164 is empty.
- Fix: Set the coverage row to 164 lines and add a behavior: after D-14, the owner capped a phase at about 15-20 plans and 4 waves and switched granularity from fine to coarse. Do not spec "prefer more, smaller plans" as the last word. Record `granularity` values actually used (`standard` default in gsd-plan.js:137, `fine`, `coarse`).

### R1-GSP-02 MAJOR citation ROADMAP.md line numbers are past the end of the file
- Severity: MAJOR
- Category: citation
- Map entry: GSP-14, GSP-15, GSP-72, Concerns (STATE/ROADMAP staleness)
- Evidence: wildera:.planning/ROADMAP.md is 74 lines (coverage table says 73). Cited lines 175-236, 198, 178, 196 and 233 do not exist. The format the entries describe is in this file: phase heading `### Phase 1: M1 P0 fixes` at line 21; `**Requirements:**` (32 IDs) at line 24; six success criteria at lines 26-32; `**Plans:** TBD` at line 33; decimal phase at lines 15 and 35; Progress `0/TBD` at line 70. The 32-ID / 6-criteria test idea is right; the citations are not.
- Fix: Replace every `ROADMAP.md` citation above line 74 with the lines above. Keep the parser contract (it matches gsd.mjs:246-257). Do not cite a longer roadmap that is not in this tree.

### R1-GSP-03 MAJOR citation GSP-60 invents a 5-file task cap and pins it on D-14
- Severity: MAJOR
- Category: citation
- Map entry: GSP-60
- Evidence: wildera:.planning/phases/01-m1-p0/01-CONTEXT.md:56-57 (D-14) says at most 2-3 tasks, a short targeted `read_first`, "few files modified", about 100k tokens. It does not say 5 files. The ">5 file modifications" / ">5 files total, CONSIDER splitting" rule is upstream context-budget.md:119 and :123 (`wildera:.agents/skills/gsd-plan/upstream/gsd-core/references/context-budget.md`), a planner heuristic, not a `gsd.mjs` lint. STATE.md:44 records a 13-file warning and a 14-file blocker from the checker, not a 5-file gate.
- Fix: Split the entry. D-14 = 2-3 tasks, targeted read_first, ~100k, disjoint owns. The 5-file figure is the upstream context-budget split hint, cited there, and it is not a mechanical error. Drop the test "6 files -> warning" unless a real checker dimension is quoted.

### R1-GSP-04 MAJOR accuracy Gap mode does not scope coverage or the path probes to new plans
- Severity: MAJOR
- Category: accuracy
- Map entry: GSP-57
- Evidence: wildera:.agents/workflows/gsd-plan.js:356-360 calls `checkLoop(..., ids)` then `handoffStage(ids, 'gap')`. `checkLoop` (lines 179-181) runs `verify-command-paths` and `verify-failure-directions` on the whole phase; only `check owns` gets `--plans`. `handoffStage` (lines 305-310) runs `check coverage` with no plan filter; `--plans` is only on the `handoff` verb. gsd.mjs:974-979 scores every plan in the phase.
- Fix: Say: ownership probe, handoff file set, and doc commit are limited to the new gap plans; requirement/decision coverage and the two verify probes still see every plan. A pre-existing unresolved `scenario:` can still stop gap closure.

### R1-GSP-05 MAJOR accuracy Skeleton wiring is realigned whenever the outline changes
- Severity: MAJOR
- Category: accuracy
- Map entry: GSP-50
- Evidence: wildera:.agents/workflows/gsd-plan.js:491-492. After an outline revision, the architect runs when `forWiring.length` OR (`useWiring` and the outline was revised and wiring was not just created this pass: `!added.length`). The prompt (line 492) says bring WIRING in line with the revised outline even if `forWiring` is empty. Target `both` does not also go to the outline planner while wiring is in use (`forOutline` is `target !== 'wiring' || !useWiring`, line 465).
- Fix: State the realign rule and the `both` partition explicitly. The current text only sends wiring/both issues to the architect.

### R1-GSP-06 MAJOR accuracy Vendor snapshot is 7 agents, plus two workflow files the summary drops
- Severity: MAJOR
- Category: accuracy
- Map entry: GSP-01
- Evidence: wildera:tools/gsd/port.mjs:22-35. Agent files: planner, plan-checker, verifier, executor, phase-researcher, debugger, debug-session-manager (7). Also copied and not named in the GSP-01 parenthetical: `gsd-core/workflows/execute-plan.md`, `gsd-core/workflows/plan-review-convergence.md`. `build`/`generate` also calls `managerTemplates` on the session-manager body (port.mjs:196-197) and throws if those anchors are gone.
- Fix: Replace "6 agents" with the seven paths. Add execute-plan.md and plan-review-convergence.md to the snapshot contract. Note the session-manager anchor check as a build failure, even though the debugger workflow is another area.

### R1-GSP-07 MAJOR coverage Checker conflict rule in DESIGN is not in the conflict list
- Severity: MAJOR
- Category: coverage
- Map entry: GSP-83 (missing item)
- Evidence: wildera:_workspace/gsd-port/DESIGN.md:161-162: "REVISION_CONFLICT does not spend an iteration, the third conflict escalates". wildera:.agents/workflows/gsd-plan.js:289-291: the first `OWNER_MARKERS` hit, including `REVISION_CONFLICT`, returns `needs-owner` immediately. GSP-46/55 describe the code. GSP-83 does not record this disagreement.
- Fix: Add the pair to GSP-83. Spec from the code: one conflict stops the run. Do not carry a three-strike rule.

### R1-GSP-08 MAJOR coverage `verify: false` skips the Verify stage and pretends green
- Severity: MAJOR
- Category: coverage
- Map entry: missing (GSP-66 describes obligation checks as unconditional)
- Evidence: wildera:.agents/workflows/code-wave.js:216-217: `if (args.verify === false) return { build: 'ok', green: true, failures: {}, unassigned: [] }`. Obligations (lines 199-213) never run. wildera:.agents/skills/code-wave/SKILL.md:55: "The Verify stage (unless `"verify": false`)". STATE.md:122 records W6 code-only with `verify:false`.
- Fix: Add the switch to the handoff-consumer contract: no build, no scenarios, no `test:`/`cmd:` obligation check, synthetic green, review still runs on dirty tasks. Obligation checks also run only when `v.build === 'ok'` (code-wave.js:200).

### R1-GSP-09 MINOR accuracy `## OUTLINE COMPLETE` is not required to be the last line
- Severity: MINOR
- Category: accuracy
- Map entry: GSP-24
- Evidence: wildera:tools/gsd/gsd.mjs:512 sets `complete` with `/^## OUTLINE COMPLETE\s*$/m`, any matching line. Prompts (gsd-plan.js:382-383) still tell the planner to end the file with that line.
- Fix: Say the flag is "a line that is exactly that marker", and that the prompt, not the parser, asks for it to be last.

### R1-GSP-10 MINOR accuracy review-gate is not the same null-verdict rule as code-wave
- Severity: MINOR
- Category: accuracy
- Map entry: GSP-68
- Evidence: wildera:.agents/workflows/review-gate.js:54 uses `vd?.verdict ?? 'confirmed'` and does not retry. code-wave.js:291-296 retries once, then `vd?.verdict ?? 'unverified'`, and escalates instead of fixing.
- Fix: If the entry stays, say the gates match on confidence/likelihood/trigger but not on a missing verdict. DROP can remain.

### R1-GSP-11 MINOR coverage Shared-file scan skip list
- Severity: MINOR
- Category: coverage
- Map entry: GSP-23
- Evidence: wildera:tools/gsd/gsd.mjs:470-476. Depth-5 walk of `game/` does not enter Intermediate, Binaries, Saved, Content, Private, Public, DerivedDataCache. A `Path:` prefix that only covers a shared file under Content/Private/Public is not caught by the scan (path rules still catch `*.Build.cs`, `*.ini`, `Config/`).
- Fix: Name the skipped directories. Same for the verify source walk (gsd.mjs:362): Intermediate, Binaries, Saved, ThirdParty, which GSP-19 already has.

### R1-GSP-12 MINOR accuracy `checked` is recorded once, and only in plan mode
- Severity: MINOR
- Category: accuracy
- Map entry: GSP-55
- Evidence: wildera:.agents/workflows/gsd-plan.js:619-627 records `revisions record checked` after `checkLoop` returns in plan mode. The gaps branch (lines 356-360) never records `checked`. The record is not per iteration.
- Fix: Say "once, after a passing plan-mode checker". Gap mode has no `checked` key.

### R1-GSP-13 MINOR accuracy Verb prose exclusions are a fixed set
- Severity: MINOR
- Category: accuracy
- Map entry: GSP-09
- Evidence: wildera:tools/gsd/port.mjs:230. `PROSE` is `is, as, to, the, a, and, or, on, in, function, launcher, call, calls, resolves, resolver`. Deeper than depth 1, verbs are not collected (line 277). Unknown `check <sub>` throws exit 1 (`unknown check`), not 69 (gsd.mjs:981); only an unknown `query` verb hits the 69 default (gsd.mjs:935).
- Fix: Quote the set. Split "unknown query verb → 69" from "unknown check subcommand → 1".

### R1-GSP-14 MINOR accuracy `verification.status` stale is exit 0
- Severity: MINOR
- Category: accuracy
- Map entry: GSP-35
- Evidence: wildera:tools/gsd/gsd.mjs:778-781. A fingerprint mismatch or a fingerprint recompute that itself fails (`fp.code !== 0`, including a missing covered file) sets `status: stale` and returns code 0. Invalid reports write `VERIFICATION.md invalid: ...` to stderr and exit 1 (lines 774-776). gsd-verify.js:86 therefore returns `stale` to the caller instead of `failed`.
- Fix: State exit 0 for stale, including when a covered file is missing at status time. Reserve exit 69 for the `verification.fingerprint` verb (gsd.mjs:755).

## Citations checked

| map entry | citation | ok / wrong |
|---|---|---|
| GSP-01 | port.mjs:19-35,71-86,98-112 | ok (PIN, SNAPSHOT, symlink error, HEAD must equal PIN, UPSTREAM.json). Parenthetical "6 agents" is wrong; see R1-GSP-06 |
| GSP-01 | UPSTREAM.json:1-9 | ok (repo, branch, commit 274f8ca…, date, license, vendored, files) |
| GSP-02 | port.mjs:87-96 | ok (HEAD, loose ref, packed-refs; no git) |
| GSP-03 | port.mjs:37-55,122-143; gsd-planner.md:1-22 | ok (5 generated agents, include list, precedence block, model pro) |
| GSP-04 | port.mjs:64-69 | ok (three rewrites, lookbehind) |
| GSP-05 | port.mjs:144-166; executor-rules.md:1-12 | ok (preface bullets and three block names; line 17 starts `deviation_rules`) |
| GSP-06 | port.mjs:167-189; upstream plan-phase.md:751 and :1138 | ok (`## 8. Spawn gsd-planner Agent`, `## 12. Revision Loop`) |
| GSP-08 | port.mjs:201-220 | ok (strict verify then write) |
| GSP-09 | port.mjs:222-285 | ok on exit, depth, verb scan. Prose set and unknown-check exit are incomplete; see R1-GSP-13 |
| GSP-11 | gsd.mjs:36-75,935,957-959 | ok (ported false → 69 with reason; query default text includes "continue without it") |
| GSP-12 | gsd.mjs:1058-1069 | ok (`--pick`, `{status:error}`, integer code else 1). Header at :10-11 understates writers; code also writes via attempt, supersede, handoff |
| GSP-14 | gsd.mjs:214-237 | ok (pad, decimal dirs, KINDS, plan id) |
| GSP-14 | ROADMAP.md:198 | wrong. File ends at line 74. Decimal phase is lines 15 and 35 |
| GSP-15 | gsd.mjs:239-259,910-921 | ok (heading parse, get-phase 66, analyze) |
| GSP-15 | ROADMAP.md:175-236 | wrong. Requirements line is 24; six criteria are 26-32 |
| GSP-16 | gsd.mjs:260-270; adapter.md:35-37; REQUIREMENTS.md:1-12,38-45 | ok. CONFLICT is real: adapter wants `UX-LIVE:R3`; table uses `SW-07` / `HAR-01` |
| GSP-17 | gsd.mjs:273-339 | ok (required fields, task regex, checkpoint tags, truncation, type tdd, owns) |
| GSP-19 | gsd.mjs:356-396,963-967 | ok (WildEra. prefix, pending_creation, exit 0 with ok/issues, no plans → 69). Unknown kind is a probe blocker at :374; not stated |
| GSP-22 | gsd.mjs:974-980 | ok (roadmap entry required, extra non-blocking, decisions included) |
| GSP-24 | gsd.mjs:492-513 | mostly ok. `complete` is any exact marker line, not necessarily the last (R1-GSP-09) |
| GSP-26 | gsd.mjs:569-580,636 | ok (wave 1, no consumes, outcome, scenario, `none:` warning; handoff tracer = any task type tracer) |
| GSP-28 | gsd.mjs:622-673; handoff/w1.args.json:1-40 | ok (tracer alone, plan-01-01, Path:SUMMARY, planHash 12 hex, wave full) |
| GSP-29 | gsd.mjs:675-704,997-1015 | ok (keys, roadmap section in the hash, head stored not hashed, headChanged, atomic write). DESIGN.md:86-88 does include a baseline-commit hash the code does not |
| GSP-33 | gsd.mjs:706-737 | ok (66 missing, sections, marker, stale, later attempt hides an older complete report) |
| GSP-35 | gsd.mjs:751-782 | mostly ok. Stale is exit 0, including a failed recompute (R1-GSP-14) |
| GSP-38 | gsd-plan.js:51-77 | ok (1..3 hard fail, empty lanes fail, reviewer default sol-fast) |
| GSP-47 | gsd-plan.js:364-405 | ok (reuse rule, null regeneration fails if a file existed, two fix turns, record inputs) |
| GSP-50 | gsd-plan.js:464-523; skeleton-review.md:44 | code stall matches the map note (compare before adding architect issues). The "only wiring-targeted issues go to the architect" sentence misses line 491 (R1-GSP-05) |
| GSP-52 | gsd-plan.js:525-560; 01-OUTLINE-REVIEW.md:5 | ok (300-char evidence, freeze only on passed, "1: 38 open; 2: 4 open; 3: 0 open") |
| GSP-55 | gsd-plan.js:172-301,619-628 | loop, probes, cap options, stall options ok. `checked` recorded once in plan mode only (R1-GSP-12) |
| GSP-57 | gsd-plan.js:318-361; SKILL.md:72 | resume/sourceSha/written_status and "one wave" prose vs no code cap: ok. "coverage for only the new plans": wrong (R1-GSP-04) |
| GSP-60 | 01-CONTEXT.md:56-57 | wrong for "<=5 files". D-14 is 2-3 tasks, few files, ~100k (R1-GSP-03) |
| GSP-61 | gsd-research.js:16-105 | ok (UUID, signature, key, blocked same signature, readback, null+valid report accepted) |
| GSP-64 | gsd-verify.js:31-94 | ok (baseline required, key, file wins, same sha rejected, stale logged) |
| GSP-66 | code-wave.js:31-37,68-71,196-214,296 | ok on RESULT_GSD, brief, 900s cmd, unverified. `verify:false` at :216 omitted (R1-GSP-08) |
| GSP-68 | review-gate.js:1-67 | "same gate" is wrong for a missing verdict (R1-GSP-10). Owner date comment at :9 is real |
| GSP-75 | gsd-plan.js:269-272; STATE.md:44 | ok (options include force proceed; no arg; Phase 01 override at Check iteration 1) |
| GSP-79 | STATE.md:32-36,136,140,151 | ok (Sol/Sonnet/Haiku, then Opus, Grok reviewers, extra plan-review sentence) |
| GSP-81 | STATE.md:124,131,151; SKILL.md:61-73 | ok as a conflict: skill still says code-wave + one gap wave; later notes say one Opus, no code-wave Verify loops |
| GSP-83 | DESIGN.md:14,43-46,100,84-88; SKILL.md:52; skeleton-review.md:44 | items (1)-(5),(7),(8) match those lines. Item (6) architect-prompt.md:14 is the Go-backend sentence, not "No backend exists". Missing DESIGN.md:161-162 (R1-GSP-07) |
| GSP-49 | STATE.md:162 | ok (4 lanes: fidelity, integration, runtime-feasibility, test-integrity). Lines 163-164 are the next owner correction and are not in the map |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
|---|---|---|
| wildera:tools/gsd/gsd.mjs | yes (1070; file is 1071) | 3 (scan skip dirs; unknown-check exit 1; status stale exit 0) |
| wildera:tools/gsd/port.mjs | yes (292; file is 293) | 2 (7th agent + execute-plan/plan-review-convergence; managerTemplates anchor check) |
| wildera:.agents/workflows/gsd-plan.js | yes (629; file is 630) | 3 (wiring realign; gap probe/coverage scope; checked only in plan mode) |
| wildera:.agents/workflows/gsd-research.js | yes (105; file is 106) | 0 in the contract GSP-61 states (ROADMAP `phase_found` is required at line 36; skill text covers "no ROADMAP entry") |
| wildera:.agents/workflows/gsd-verify.js | yes (94; file is 95) | 0 |
| wildera:.agents/workflows/code-wave.js | yes (361; file is 362) | 1 (`verify: false` synthetic green). Other wave machinery is pointed at the workflow area |
| wildera:.agents/workflows/review-gate.js | yes (67; file is 68) | 1 (missing verdict defaults to confirmed, no retry) |
| wildera:.agents/skills/gsd-plan/SKILL.md | yes | 0 (commitDocs wording conflict is recorded) |
| wildera:.agents/skills/gsd-plan/NOTICE.md | yes | 0 |
| wildera:.agents/skills/gsd-plan/LICENSE | yes (partial) | 0 (not re-read; MIT claim not disputed) |
| wildera:.agents/skills/gsd-plan/references/adapter.md | yes | 0 |
| wildera:.agents/skills/gsd-plan/references/compatibility.md | yes | 0 |
| wildera:.agents/skills/gsd-plan/references/manifest.md | yes | 0 |
| wildera:.agents/skills/gsd-plan/references/skeleton-review.md | yes | 0 |
| wildera:.agents/skills/gsd-plan/generated/executor-rules.md | yes (partial) | 0 in the preface that was read |
| wildera:.agents/skills/gsd-plan/generated/plan-phase-contracts.md | yes (partial) | not re-read; anchor list matches port.mjs |
| wildera:.agents/skills/gsd-discuss/SKILL.md | yes | 0 |
| wildera:.agents/skills/gsd-discuss/generated/discuss-phase.md | yes (partial, machine-compared) | not re-read; equality claim not re-run |
| wildera:.agents/skills/gsd-research/SKILL.md | yes | 0 |
| wildera:.agents/skills/gsd-research/references/adapter.md | yes | 0 |
| wildera:.agents/skills/code-wave/SKILL.md | yes (92; file is 93) | 0 beyond `verify: false`, which the skill states at line 55 and the map drops |
| wildera:.agents/skills/code-wave/references/architect-prompt.md | yes | 0 (line 14 is the Go backend, as GSP-83 item 6 says) |
| wildera:.agents/skills/gsd-plan/upstream/** | yes (listed; UPSTREAM.json head read) | 0 as a listing. Do not treat the GSP-01 parenthetical as the file list |
| wildera:.agents/agents/gsd-planner.md | yes (partial) | header 1-22 matches port.mjs. Body equality not re-run; first body line `<role>` matches upstream after front matter |
| wildera:.agents/agents/gsd-plan-checker.md | yes (partial) | not re-read past the method claim |
| wildera:.agents/agents/gsd-verifier.md | yes (partial) | not re-read past the method claim |
| wildera:.agents/agents/gsd-phase-researcher.md | yes (partial) | not re-read past the method claim |
| wildera:.agents/agents/gsd-skeleton-reviewer.md | yes | 0 |
| wildera:.agents/agents/wiring-architect.md | yes (35; file is 36) | 0 |
| wildera:.agents/agents/finding-verifier.md | yes | 0 |
| wildera:.agents/agents/ue-coder.md | yes | 0 in the header and role open |
| wildera:.agents/agents/ue-reviewer.md | yes | not re-read this pass |
| wildera:_workspace/gsd-port/DESIGN.md | yes (181; file is 182) | 1 (third-conflict sentence at 161-162 missing from GSP-83) |
| wildera:.planning/STATE.md | yes, "162 / yes" | 1 BLOCKER: lines 163-164 not reflected. Claim of fully read is false |
| wildera:.planning/ROADMAP.md | yes | 0 behaviors omitted; citations to lines >74 are wrong (R1-GSP-02) |
| wildera:.planning/REQUIREMENTS.md | yes (47; file is 48) | 0 |
| wildera:.planning/phases/01-m1-p0/ (sample set) | yes | 0. 37 PLAN.md files are present; no VERIFICATION.md. D-14 text does not contain a 5-file cap |
| wildera:_workspace/gsd/ (listed) | yes | not re-listed this pass |
