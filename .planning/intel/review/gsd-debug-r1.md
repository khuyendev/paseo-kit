# Review r1: GSD debug and forensics

## Verdict

REVISE. 0 blocker, 8 major, 8 minor. The map is a serious reading of a large crash-safe debug system: role split, tree digest, typed requests, replay-safe turns, revert transactions, acceptance, lease, and the forensics skill are present and mostly faithful, and the KEEP/CHANGE split (generic session machine, WildEra experiment kinds in the adapter, Paseo/`ph` as host, multi-runtime shims dropped) matches the owner decisions. It cannot pass yet. Several contracts are stated wrong (knowledge-base update, binary provenance on resume, which writers block the lease, what `perRunMinutes` controls, the checkpoint prompt's goal), and a few failure paths that change files or leave authorization in place are missing. Taken as the spec, those become wrong requirements.

## Findings

### R1-GDB-01 MAJOR accuracy Knowledge-base entry is appended, not rewritten
- Severity: MAJOR
- Category: accuracy
- Map entry: GDB-32
- Evidence: wildera:tools/gsd/debug.mjs:874-878
- Fix: Replace "once per resolution (rewritten if reopened)" with the actual rule. `close --outcome resolved` appends one `## <slug> — …` entry. If that heading is already in the file and `st.reopened` is empty, it does not write again. If the session has ever been reopened (`reopened` non-empty), every later resolved close appends another entry and leaves the old one. Nothing rewrites or deletes the previous heading. Header text is hardcoded in debug.mjs (the upstream wording), not read from a template.

### R1-GDB-02 MAJOR accuracy Binaries are cleared only on a new invocation
- Severity: MAJOR
- Category: accuracy
- Map entry: GDB-19
- Evidence: wildera:tools/gsd/debug.mjs:637-642,674-676
- Fix: `st.binaries = {}` runs only when a new invocation record is created. `invocation start` for an id that already exists returns `resumed:true` first and does not clear binaries, does not change status, and does not re-apply `goal`. Say that a resumed invocation keeps the binaries recorded for that invocation; only a new UUID forces a rebuild check against the current digest.

### R1-GDB-03 MAJOR accuracy Writer-quiescence roots are not "the same code root"
- Severity: MAJOR
- Category: accuracy
- Map entry: GDB-34
- Evidence: wildera:tools/gsd/debug.mjs:353-378
- Fix: Replace "code-wave|gsd-plan|gsd-verify in the same root". The root used for the comparison is `path.resolve(HARNESS, args.cwd ?? '.')` for `code-wave` only; for every other workflow name it is `ctx.HARNESS` (the kit checkout), not `ctx.ROOT`. So `gsd-plan` and `gsd-verify` block a debug lease only when the debug code root is the harness checkout. `code-wave` blocks only when its `args.cwd` resolves to the debug root. Any workflow name outside `code-wave|gsd-plan|gsd-verify|gsd-debug|gsd-research|review-gate` blocks regardless of root. A `gsd-debug` run is skipped only when `args.slug` equals this session (and, separately, when `run.json`'s pid is the runner's grandparent). Name comes from `run.json.name` or the script basename, because a running run.json has no name yet. Keep the 7-day mtime filter, `status:'running'`, live pid, and the fail-closed `paseo ls` error, which the entry already has.

### R1-GDB-04 MAJOR coverage Unverified Paseo listing keeps the lease
- Severity: MAJOR
- Category: coverage
- Map entry: GDB-35
- Evidence: wildera:tools/gsd/debug.mjs:891-900,916-919,927-929
- Fix: Add that `supervise`'s `stopEngines` pushes the string `paseo agents unverified` into the alive list when `paseo ls --json` throws. That string counts as a living worker: a dead runner then returns without releasing the lease (`kept: workers still alive`), and the deadline grace path does not call `finalize` while that entry is present. Archive match stays `^gsd-debug:` and the name contains the slug (the map's concern about `Debug:<slug>` / `debugger:<slug>` is right; do not drop it).

### R1-GDB-05 MAJOR accuracy Workflow perRunMinutes does not set the kill cap
- Severity: MAJOR
- Category: accuracy
- Map entry: GDB-36
- Evidence: wildera:.agents/workflows/gsd-debug.js:42-45,73; wildera:tools/gsd/debug.mjs:773-775
- Fix: State two different clocks. `args.perRunMinutes` (default 30) is only the workflow `shell()` wait for `debug run`: `perRunMinutes * 60 + 900` seconds. The workflow never passes `--capMinutes`. The process-tree kill deadline is `min(now + limits.perRunMinutes, invocation deadline)`, and `limits.perRunMinutes` is set at `debug create` (`inp.perRunMinutes` or 30), not from workflow args. Also record the default `shell()` timeout of 600s on every other `gsd.mjs` call (`gsd-debug.js:44`). A spec that wires `args.perRunMinutes` to the kill cap would not match this system.

### R1-GDB-06 MAJOR coverage Budget refusal drops a checkpoint answer that was already written
- Severity: MAJOR
- Category: coverage
- Map entry: GDB-20
- Evidence: wildera:tools/gsd/debug.mjs:649-669
- Fix: Document the order and the failure path. For an open checkpoint, a matching answer is written into the session markdown (4-space DATA block) before the wall-budget check. `saveState` runs only after that check passes. If remaining minutes are `<= 0` (`minutes - round(wallMs/60000)`), the command returns `refused:'budget'` and does not save: state still has an unanswered checkpoint, the markdown already contains the response, and a later start asks again and appends another block. This includes a `human-verify` answer (no extension required) when the wall is already spent, so the "confirmed, no new runs" close in GDB-42 is unreachable until the wall is extended, and the confirmation is not stored. The earlier refuse (`budget` type and no `budgetExtension`) returns before the markdown write; do not conflate the two.

### R1-GDB-07 MAJOR coverage Reopen keeps the previous authorizedDelta
- Severity: MAJOR
- Category: coverage
- Map entry: GDB-10
- Evidence: wildera:tools/gsd/debug.mjs:563-570,879
- Fix: On reopen, state drops `acceptance.current` and `acceptance.passed` and appends `reopened`, but it does not clear `authorizedDelta` or `resolution`. `reconcile check` still treats every `*.state.json` `authorizedDelta` as authorized, including a session that is open again. Say that explicitly. Also say `authorizedDelta` is a union added only by `close --outcome resolved` from `inp.delta` (the attempt's path list), not "closed sessions" in the sense of files under `resolved/` only.

### R1-GDB-08 MAJOR accuracy Checkpoint continuation hardcodes find_and_fix
- Severity: MAJOR
- Category: accuracy
- Map entry: GDB-22
- Evidence: wildera:.agents/skills/gsd-plan/upstream/agents/gsd-debug-session-manager.md:89-93,250-278; wildera:tools/gsd/debug.mjs:957-962,969-978
- Fix: Do not say `{goal}` is filled in both templates. Step 2's markdown block substitutes `{goal}` and `{symptoms_prefilled}`. The first ```markdown block after `### 3d. CHECKPOINT REACHED` (the block `managerTemplates` actually loads; the earlier ``` fence is not marked markdown) hardcodes `goal: find_and_fix` and has no symptoms placeholder. A `find_root_cause_only` checkpoint turn therefore tells the debugger to find and fix in `<mode>`, while `<runtime_adapter>` may still say `product-read-only`. Record that contradiction. `tdd_mode` / `tdd_phase` stay false, so those `{if …}` lines are stripped in both blocks.

### R1-GDB-09 MINOR accuracy Acceptance reserve math and which signature is reverted
- Severity: MINOR
- Category: accuracy
- Map entry: GDB-14, GDB-09, GDB-31
- Evidence: wildera:tools/gsd/debug.mjs:341-342,614,750-753; wildera:.agents/workflows/gsd-debug.js:111-127
- Fix: `reserve` is non-build plan items plus `revertRuns` (2, or 0 when the signature rerun's kind is `build`). The GDB-14 test equation `1 + 1 + 2 > 3` treats reserve as the plan length only; with a non-build signature, two plan items make reserve 4. When the signature kind is `build`, `revertRuns` is 0, but the workflow still runs revert-and-reconfirm unless `acceptDebt`. That pair is not held back from experiments and can hit `budget-exhausted` mid-attempt. Revert-and-reconfirm reruns only `plan.find(role === 'signature')` (the first signature item), then one green of that same item. The earlier loop greens every plan item, including every frame-rate edge. Say that; do not let "at every edge" describe the red run.

### R1-GDB-10 MINOR coverage Turn-begin refusals are not in the loop description
- Severity: MINOR
- Category: coverage
- Map entry: GDB-38
- Evidence: wildera:.agents/workflows/gsd-debug.js:201-204
- Fix: GDB-21 mentions the CLI refusals and GDB-23 names the types, but the loop entry skips the branch that actually stops the invocation. `turn begin` `deadline` calls `deadlineStop`. `turn-cap` ends `needs-owner` with a checkpoint key `<inv>:turn-cap`, question about the hard cap, and type `turn-cap`. Any other begin failure ends `failed`. A stored decision replays with `continue` and does not re-audit that turn.

### R1-GDB-11 MINOR accuracy isShared is a regex, not the prompt's word list
- Severity: MINOR
- Category: accuracy
- Map entry: GDB-26
- Evidence: wildera:tools/gsd/gsd.mjs:463-465
- Fix: `ctx.isShared` is `/\.(Build\.cs|Target\.cs|uproject|uplugin|ini)$/i` on the path, or `^game/(?:.+/)?Config(?:/|$)`. Any `.ini` is shared; `Config/` is shared only under `game/`. The prompt's "Config/" sentence is wider than the check. `grant` and `delta` use `isShared`, not the prompt text. Owns prefixes come from `ownedPrefixes` (`Module:Folder` -> Public/Private, `Content:`, `Path:`), which throws on a bad entry; a throw from `delta` becomes a scope stop because the workflow treats any non-zero `delta` as needs-owner.

### R1-GDB-12 MINOR accuracy reproduces() and FPS evidence are tighter than the summary
- Severity: MINOR
- Category: accuracy
- Map entry: GDB-17, GDB-18
- Evidence: wildera:tools/gsd/debug.mjs:445-468,490-493
- Fix: `reproduces` returns false whenever `passed !== false`, not only when the run passed (a null `passed` is false, not null). A failed test whose name does not match returns false, not null; null is the no-pattern scenario key, the non-matching kind pair, and the obligation early exits. Obligation is the only kind that forces null on timeout. Crash matching strips a leading `the test process crashed:` and a trailing ` (…)` token, then requires every remaining ` | `-separated line in whitespace-collapsed test text plus `=== Critical error: ===`. Build matching is a log line that contains the key after `\` -> `/` and matches `/[:)]\s*(?:fatal )?error\b/i`, not "a line matching error". FPS evidence: if `scenarioRequest(...).fps > 0`, schema-4 results use each launch's `client.log`; otherwise one `client.log` next to the result. Each must be fresh and contain `t.MaxFPS=N` and `FrameRateLimit=N`.

### R1-GDB-13 MINOR citation Wrong line for the safe-resume comment
- Severity: MINOR
- Category: citation
- Map entry: GDB-05
- Evidence: wildera:tools/gsd/debug.mjs:98
- Fix: The "Why" line says the upstream citation sits in "comment 213-234". The comment is line 98: `upstream 213-234`. Keep 65-111 and 879 as the behavior citations; point the rationale at line 98.

### R1-GDB-14 MINOR coverage Dispatcher envelope, exit 69, init.debug, lock record
- Severity: MINOR
- Category: coverage
- Map entry: GDB-33, GDB-56
- Evidence: wildera:tools/gsd/gsd.mjs:871-873,945-953,1066-1068; wildera:tools/gsd/debug.mjs:406-416
- Fix: Thrown `fail()` is printed as one JSON line `{status:'error', error: message}` with `e.code` (default 1). That is what the workflow reads as `json.error`. `--root` that is not a git checkout or worktree root throws before `debugMain`, exit 69. `query init.debug` (called from the vendored `debug.md` step 0, not from `gsd-debug.js`) returns `{debug_dir, project_root, commit_docs:false, tdd_mode:false, debugger_model:'circle/gpt-6.1-sol[1m]', section_manifest:null, note}`. Add the lock file fields: `token`, `slug`, `codeRoot` (resolved), `invocation`, `runnerPid` (grandparent via CIM; null if that query fails), `phase` `pending` then `active`, `acquiredAt`, `leaseUntil`, `renewedAt`, optional `supervisorPid`. `renew --supervisor <pid>` can set `supervisorPid`; the workflow's `supervisor` command writes it itself. `lock clear` with no lock returns exit 0 `{cleared:false, reason:'no lock'}`.

### R1-GDB-15 MINOR structure Coverage line counts are short by one
- Severity: MINOR
- Category: structure
- Map entry: Coverage
- Evidence: wildera:tools/gsd/debug.mjs:998; wildera:.agents/workflows/gsd-debug.js:319; wildera:tools/gsd/port.mjs:293; wildera:.agents/skills/gsd-forensics/generated/forensics.md:287; wildera:_workspace/gsd-port/DESIGN.md:182
- Fix: Those files are 998, 319, 293, 287, and 182 lines as read (the last line is blank or the closing line the table missed). The "read fully" claims for debug.mjs, the workflow, port.mjs, the forensics skill, adapter, and DESIGN.md hold: DESIGN.md has no debug or forensics section (it stops at the 2026-10-18 plan-port notes; line 178 really does forbid `Date.now` in ph workflow scripts). gsd-debugger.md's partial read matches the mapper brief (header plus path rewrites); the protocol sections the map cites (604-700, 830-1018, 1111-1272) are present and match the entries that quote them. No required section is missing, IDs GDB-01..59 are unique, and the Date.now CONFLICT shows both sides.

### R1-GDB-16 MINOR structure Proposal line mixes KEEP and OPEN
- Severity: MINOR
- Category: structure
- Map entry: GDB-04
- Evidence: wildera:tools/gsd/debug.mjs:253-260
- Fix: Use one proposal. The behavior to keep is the mtime bump (`max(floor(now_s), floor(prev_mtime_s)) + 1`, applied to atime and mtime, skipped if the path is gone). "Hash bytes yourself and drop the bump" is an OPEN alternative, not a second proposal on the same line. The compatibility rationale at compatibility.md:102 matches the comment.

## Citations checked

| map entry | citation | ok / wrong |
| --- | --- | --- |
| GDB-01 | debug.mjs:1-11,37 | ok (header commands; line 37 is atomic replace) |
| GDB-01 | gsd-debug.js:34-50 | ok as the shell boundary; it is arg checks and `shell()`, not the role split itself |
| GDB-01 | gsd-debug.js:234 | ok (only the workflow may mark resolved) |
| GDB-02 | debug.mjs:20-23,46-57 | ok (manifest, exclude, digest prefix `wildera-tree`) |
| GDB-03 | debug.mjs:58-63 | ok (`digest` / `changed` shapes and the usage throw) |
| GDB-04 | debug.mjs:253-265 | ok |
| GDB-04 | compatibility.md:102 | ok |
| GDB-05 | debug.mjs:65-111,879 | ok for the check algorithm and `authorizedDelta` |
| GDB-05 | why "comment 213-234" | wrong: the comment is debug.mjs:98 and it points at upstream 213-234 |
| GDB-07 | debug.mjs:117-118,585-588 | ok (regex max 30; error text uses `*`) |
| GDB-07 | gsd-debugger.md:730 | ok (lowercase, hyphens, max 30) |
| GDB-08 | registry.json:1-30 | ok in substance (file ends at line 28; both signature records match) |
| GDB-09 | debug.mjs:590-619 | ok, including `revertRuns` 0 vs 2 and stdin budget overrides |
| GDB-11 | debug.mjs:155-171,621-625 | ok (vague next_action, symptoms hash, exit 0/1/66) |
| GDB-11 | gsd-debugger.md:664-678 | ok |
| GDB-13 | debug.mjs:173-227 | ok (allowlists, ranges, argv key) |
| GDB-16 | debug.mjs:759-781 | ok (record-then-spawn; replay completed/uncertain/refused/running) |
| GDB-17 | debug.mjs:470-515 | ok for exec; FPS schema branch is under-specified (see R1-GDB-12) |
| GDB-18 | debug.mjs:444-469 | ok as the matcher location; false-vs-null is over-simplified (R1-GDB-12) |
| GDB-19 | debug.mjs:674-676 | wrong as "invocation start clears binaries"; resume returns at 638-642 |
| GDB-20 | debug.mjs:627-679 | lines match the success path; the unsaved budget refusal is at 649-669 (R1-GDB-06) |
| GDB-22 | debug.mjs:952-997 | ok for the renderer; goal fill is not true of the 3d block (R1-GDB-08) |
| GDB-22 | port.mjs:196-197 | ok (`managerTemplates` during generate) |
| GDB-23 | debug.mjs:717-729 | ok (idempotent unanswered key; status becomes the budget type) |
| GDB-24 | gsd-debugger.md:37 | ok (DATA_START security note) |
| GDB-27 | debug.mjs:229-241,802-810 | ok (ensure semantics, staged.patch, outside worktree) |
| GDB-28 | debug.mjs:266-331 | ok (backup before mutation; recover calls reapply) |
| GDB-29 | debug.mjs:790-801 | ok (top-level `Saved/Logs/*.log` and `_workspace/scenario/run-*`) |
| GDB-31 | gsd-debug.js:97-160 | ok; red run is the first signature item only (R1-GDB-09) |
| GDB-32 | debug.mjs:855-883 | range is right; "rewritten if reopened" is not what 878 does (R1-GDB-01) |
| GDB-32 | gsd-debugger.md:994-1018 | ok (entry shape and header the port copies) |
| GDB-33 | debug.mjs:347-432 | ok (pending, 45 min, token, stale clear) |
| GDB-34 | debug.mjs:353-379 | lines are the source; "same root" does not match 364-366 (R1-GDB-03) |
| GDB-35 | debug.mjs:884-948 | ok for the deadline vs dead-runner split; paseo failure path under-specified (R1-GDB-04) |
| GDB-38 | gsd-debug.js:198-241 | ok for audit, delta, one repair turn; begin refusals at 201-204 not described (R1-GDB-10) |
| GDB-39 | gsd-debug.js:11-32,245-313 | ok (markers and routing, including TDD falling through) |
| GDB-42 | gsd-debug.js:179-190,275-295 | ok (machine close vs ownerOnly; confirm reuses acceptance) |
| GDB-42 | compatibility.md:85 | ok (owner choice a, 2026-10-19) |
| GDB-45 | port.mjs:43-45,64-69,122-142 | ok (tools, includes, path rewrite, precedence block) |
| GDB-45 | gsd-debugger.md:1-17 | ok |
| GDB-48 | adapter.md:34-45 | ok |
| GDB-52 | forensics SKILL.md:8-25 | ok |
| GDB-52 | forensics.md:174-239 | ok (upstream `report-<timestamp>.md`, redaction, 50-line diffs) |
| GDB-53 | forensics.md:257-286; port.mjs:193-195 | ok (issue step and shim remain in the generated file) |
| GDB-54 | port.mjs:19-35,98-112,244-284 | ok (pin, symlink refusal, check problems, exit 1) |
| GDB-58 | camera-orbit-s103.md:114-133 | ok (DATA block; indented `## CHECKPOINT REACHED` is not a section) |
| GDB-58 | debug.mjs:131-136 | ok (`sectionOf` splits on `^## `) |
| GDB-59 | debug.mjs:826; gsd-debug.js:105 | ok (`empty:true` becomes a failed string back to the debugger, not an owner stop) |
| Concerns | gsd-debug.js:220 vs DESIGN.md:178-179 | ok (both sides exist) |
| Concerns | gsd-debugger.md:966 | ok (multi-runtime `gsd_run` shim in archive_session) |

## Coverage check

| in-scope file | in map table | omitted behaviors found |
| --- | --- | --- |
| wildera:tools/gsd/debug.mjs | yes (997; file is 998) | 6 (KB append, resume binaries, writer roots, supervise paseo failure, unsaved answer, authorizedDelta on reopen) |
| wildera:.agents/workflows/gsd-debug.js | yes (318; file is 319) | 2 (perRunMinutes vs kill cap and shell timeouts; turn-begin stop branch) |
| wildera:.agents/skills/gsd-debug/SKILL.md | yes | 0 |
| wildera:.agents/skills/gsd-debug/references/adapter.md | yes | 0 |
| wildera:.agents/skills/gsd-forensics/SKILL.md | yes | 0 |
| wildera:.agents/skills/gsd-forensics/generated/forensics.md | yes (286; file is 287) | 0 (thresholds stay in the shipped text; skill overrides name, evidence, issue step, STATE) |
| wildera:.agents/agents/gsd-debugger.md | yes, partial as the brief allows | 0 beyond path-rewrite and the protocol sections cited |
| wildera:tools/gsd/port.mjs | yes (292; file is 293) | 0 for the debug check/generate path |
| wildera:_workspace/gsd-port/DESIGN.md | yes; no debug section, confirmed | 0 |
| wildera:.planning/debug/ (list + camera-orbit-s103.md) | yes | 0 (registry, session, runs/, turns/ match; no resolved/ or knowledge-base.md in the listing) |
| wildera:_workspace/gsd-debug/ (list only) | yes | 0 (camera-orbit args/run_meta/signature; fauna args + args-ck7..ck10 + signature; scene-readiness signature only) |
| wildera:.agents/skills/gsd-plan/references/compatibility.md (debug rows only) | yes, partial | 0 |
