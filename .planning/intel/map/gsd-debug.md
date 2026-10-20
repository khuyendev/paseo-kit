# Map: GSD debug and forensics (GDB)

Sources: `wildera:` = C:/Users/fish/Desktop/WildEraV6 @ 89143da. Line numbers are those of the files as read (1-based).

## Coverage

| file | lines | read fully |
| --- | --- | --- |
| wildera:tools/gsd/debug.mjs | 998 (reader count; `wc -l` 997) | yes |
| wildera:.agents/workflows/gsd-debug.js | 319 (reader count; `wc -l` 318) | yes |
| wildera:.agents/skills/gsd-debug/SKILL.md | 66 | yes |
| wildera:.agents/skills/gsd-debug/references/adapter.md | 49 | yes |
| wildera:.agents/skills/gsd-forensics/SKILL.md | 30 | yes |
| wildera:.agents/skills/gsd-forensics/generated/forensics.md | 287 (reader count; `wc -l` 286) | yes (generated, path rewrites only) |
| wildera:.agents/agents/gsd-debugger.md | 1284 | partial: 1-60 header + precedence block + role, 556-760 knowledge base / debug file protocol / first execution steps, 830-1284 diagnose-only, fix_and_verify, archive, checkpoints, returns, modes; 60-555 and 760-830 are upstream method text (hypothesis, techniques, verification patterns, research) seen only as a grep of headings and of the `@.agents/skills/gsd-plan/upstream/` path references, because port.mjs rewrites only paths there |
| wildera:tools/gsd/port.mjs | 293 (reader count; `wc -l` 292) | yes |
| wildera:_workspace/gsd-port/DESIGN.md | 182 (reader count; `wc -l` 181) | yes; it holds NO debug/forensics section (dated 2026-10-18, before the debug batch; the debug design is `_workspace/gsd-port/post-code-idea.md`, outside scope, not read) |
| wildera:.agents/skills/gsd-plan/references/compatibility.md | 64-106 | partial, outside scope; read only the Debug and forensics rows as rationale |
| wildera:tools/gsd/gsd.mjs | 455-470, 865-875, 940-956, 1060-1070 | partial, outside scope (r1): `isShared`, `init.debug`, the `--root` check and the output/error envelope |
| wildera:.agents/skills/gsd-plan/upstream/agents/gsd-debug-session-manager.md | 80-100, 240-285 | partial, outside scope (r1): the Step 2 and Step 3d prompt blocks |
| wildera:.planning/debug/ | listing | listed: registry.json (read), camera-orbit-s103.md (read fully, 134 lines), camera-orbit-s103.state.json (19.6 KB, not read), fauna-corpse-handoff.md (157 KB, not read), fauna-corpse-handoff.state.json (248 KB, not read), per-session dirs `runs/` and `turns/` (listed), no `resolved/` dir, no knowledge-base.md |
| wildera:_workspace/gsd-debug/ | listing | listed only: camera-orbit-s103/{args.json,run_meta.json,signature.json}, fauna-corpse-handoff/{args.json,args-ck7..ck10.json,signature.json}, scene-readiness/signature.json |

## Summary

The debug flow is a port of upstream `/gsd:debug` + `gsd-debug-session-manager` + `gsd-debugger` into an unattended, budgeted, crash-safe system. One debug session per failure signature lives in `.planning/debug/<slug>.md` (the debugger's brain, upstream DEBUG.md template) plus `<slug>.state.json` (machine state: budget, turns, requests, snapshots, reverts, acceptance, checkpoints) and a signature registry. The deterministic half is `tools/gsd/debug.mjs` (a CLI behind `gsd.mjs`); the orchestrating half is the workflow `gsd-debug.js`, which spawns `gsd-debugger` turns, classifies their return markers, runs the experiments the debugger may only REQUEST (typed build/test/scenario, fixed allowlist), audits that the debugger ran no engine itself, and decides acceptance on machine evidence.

Built around three ideas worth keeping in spirit: (1) identity = a tree digest over an evaluated-input manifest, so every piece of evidence binds to the exact tree it was produced on; (2) every side-effecting step is a recorded, replay-safe, idempotent transaction (turns, requests, revert/reapply, acceptance attempts), so a crashed or resumed run never relaunches an engine or loses a fix; (3) a fix is accepted only by revert-and-reconfirm (the exact signature must return with only the fix delta reverted, and go again on reapply), bounded by run/time/turn budgets enforced in code, a machine-wide lease and a detached deadline supervisor.

Generic core vs WildEra-specific: the session/turn/request/lock/snapshot/acceptance machinery, the marker protocol and the guardrail mapping are generic. Unreal specifics: MANIFEST dirs, Build.ps1/Test.ps1/Scenario.ps1 and their flag allowlist, `WildEra.<Domain>.<Capability>` filters, frame-rate (MaxFps) acceptance edges, `tools/ue/verify.mjs` validators, `Saved/Logs` audit paths, shared-file list (Build.cs, .ini, ...), Windows process tools. Forensics is an unmodified upstream workflow run read-only by the main session with an evidence-source extension.

## Behaviors

### GDB-01 Split of roles: main session, workflow, debug.mjs, debugger agent
- Behavior: the main session creates/reuses the session (`debug create`), writes args and launches the workflow detached; the workflow is the session manager (spawns `gsd-debugger` turns, runs experiments, handles returns, runs acceptance, closes); `debug.mjs` is the only writer of `.planning/debug/*.state.json`, `registry.json`, `## Checkpoints`, `## Acceptance`, `resolved/` and `knowledge-base.md`; the debugger writes only the other session sections and source files inside its edit scope. Workflow scripts have no file access, so every write goes through CLI commands; state files are replaced atomically (tmp + rename).
- Proposal: KEEP the split (decision logic in a deterministic CLI, orchestration in a workflow, thin agent); CHANGE the host: orchestration runs through Paseo/`ph` workflow, never a native Agent/Workflow tool in the main session.
- Source: wildera:tools/gsd/debug.mjs:1-11,37; wildera:.agents/skills/gsd-debug/SKILL.md:10; wildera:.agents/skills/gsd-debug/references/adapter.md:9; wildera:.agents/workflows/gsd-debug.js:34-50
- Why it exists: unattended workflows need replayable state; owner decision that only the workflow archives a session (workflow check at gsd-debug.js:234).
- Test idea: hand-edit `state.json` or move a session to `resolved/` from the debugger; the post-turn check fails and one repair turn is given, a second failure ends `failed`.

### GDB-02 Tree identity: digest over an evaluated-input manifest
- Behavior: `treeState()` = HEAD sha + `git ls-tree HEAD -- <include dirs>` + for every tracked-changed (`git diff --name-only -z --no-renames HEAD`) or untracked (`ls-files --others --exclude-standard -z`) path under the include dirs (excluding the MANIFEST exclude regex) its sha256 (`absent` if deleted); entries sorted; digest = sha256 of `"wildera-tree <manifest version>\n<ls-tree>\n<path\0hash lines>"`. MANIFEST v1: include `game tools contracts services web ops`; exclude `game/**/Saved|Intermediate|Binaries|DerivedDataCache/` and `game/compile_commands.json`. Evidence and control dirs (`.planning/`, `_workspace/`, `backlog/`, `.agents/`) are outside it, so writing evidence never changes the identity the evidence is bound to.
- Proposal: CHANGE: keep the algorithm, make include/exclude lists and the digest prefix project-adapter config (not hardcoded); `.planning/` exclusion stays mandatory in the generic core.
- Source: wildera:tools/gsd/debug.mjs:20-23,46-57
- Why it exists: "writing evidence never changes the identity the evidence is bound to" (comment); compatibility row "Identity: the working tree" -> tree digest (wildera:.agents/skills/gsd-plan/references/compatibility.md:91).
- Test idea: write a file under `.planning/` -> digest unchanged; edit a file under an included dir (same size) -> digest changes; add an untracked file under an excluded build dir -> unchanged.

### GDB-03 `tree digest|changed` CLI
- Behavior: `gsd.mjs --root R tree digest` -> `{codeRoot, manifest, digest, head}`; `tree changed` -> `{codeRoot, digest, head, changed:[{path, sha}]}`; exit 0. Any other sub: error `usage: tree digest|changed [--root R]`. `--root` is the canonical code root (a wave worktree), all git calls run `git -C R`.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:58-63,41-43
- Why it exists: not stated.
- Test idea: in a worktree, `tree digest --root <worktree>` differs from the main checkout's when the worktree holds uncommitted changes.

### GDB-04 Git stat-cache second-resolution hazard (restored files get a future mtime)
- Behavior: after `restore(p)` copies content back, the file's mtime is set to `max(now_s, previous_mtime_s) + 1` seconds, so git re-hashes it. Without this a same-size write in the same second reads as unchanged and the digest goes wrong.
- Proposal: KEEP the mtime bump as specified: `utimesSync(path, t, t)` (atime and mtime) with `t = max(floor(now_s), floor(prev_mtime_s)) + 1`, skipped when the path no longer exists. (Hashing bytes directly and dropping the bump is an alternative, listed only under Open question 7.)
- Source: wildera:tools/gsd/debug.mjs:253-265; wildera:.agents/skills/gsd-plan/references/compatibility.md:102
- Why it exists: found on a scratch repo: a same-size restore in the same second read as unchanged and broke the digest (compatibility.md:102).
- Test idea: revert then reapply a same-size edit within one second; the digest after each step equals the recorded snapshot/fix digest.

### GDB-05 `reconcile baseline|check` (pre-dispatch reconciliation)
- Behavior: `reconcile baseline --out F` writes `{codeRoot, at, digest, head, entries}`. `reconcile check --args <wave args.json> --baseline F [--authorized a,b]`: fails if the baseline's codeRoot differs (case/slash-insensitive); if HEAD moved -> exit 1 `{status:'recovery', problems:['HEAD moved ...record a new baseline after the commit']}`; changed paths = entries differing between baseline and now; authorized = `--authorized` list + every debug session's `authorizedDelta`; per task (key, summary, owns prefixes via `ctx.ownedPrefixes`): a changed path owned by several tasks is a problem; a changed path owned by none and not authorized is a problem; implementation changed in a task's owns while its SUMMARY file is missing = interrupted attempt (never launch another coder on top); a SUMMARY whose `key-files` created/modified list names files that no longer exist is a problem. Exit 1 with `status:'recovery'` when any problem, else 0 `status:'ok'`. Output includes `perTask`, `changed`, `authorized`, `problems`.
- Proposal: CHANGE: this is the execute-phase `safe_resume_gate`, not debug; move to the gsd-execute area (GDB only supplies `authorizedDelta` from closed debug sessions). Keep the semantics.
- Source: wildera:tools/gsd/debug.mjs:65-111,879
- Why it exists: upstream execute-phase safe_resume_gate (the comment at debug.mjs:98 reads `upstream 213-234`; those upstream lines were not read by me); compatibility row "reconcile ... before any coder (re)dispatch" (compatibility.md:99); the forensics skill points at it for partial-plan drift (wildera:.agents/skills/gsd-forensics/SKILL.md:21).
- Test idea: modify a file inside task A's owns without writing A's SUMMARY -> `check` exits 1 naming A; add the path to `--authorized` or to a closed session's fix delta -> a path outside every owns passes.

### GDB-06 Session files and directory layout
- Behavior: under the code root `.planning/debug/`: `<slug>.md` (active session), `resolved/<slug>.md` (after close resolved), `<slug>.state.json`, `registry.json`, `knowledge-base.md` (excluded from `list`), `<slug>/runs/` (`<id>.log`, `<id>.pid`, `<id>.result.json`, `<id>.test.log`), `<slug>/turns/<inv8>-<k>.prompt.md`, `<slug>/deadline.json`. `mdOf` resolves active first, then resolved. A `diagnosed` session stays in the active dir.
- Proposal: KEEP the layout (state.json and registry are the machine record; session md is the human/agent record). OPEN whether run logs and turn prompts (megabytes: 275 KB test logs per run) stay in `.planning/` or move under `_workspace/` (see Open questions).
- Source: wildera:tools/gsd/debug.mjs:115-129,438-440,693; wildera:tools/gsd/debug.mjs:888; wildera:.planning/debug listing (registry.json, camera-orbit-s103.md, .state.json, runs/, turns/); wildera:.planning/debug/camera-orbit-s103/runs/ (x-3922d90e-0.test.log 275554 bytes)
- Why it exists: upstream DEBUG_DIR / DEBUG_RESOLVED_DIR (wildera:.agents/agents/gsd-debugger.md:606-611).
- Test idea: create + close a session; files land exactly in the layout above and `list` ignores knowledge-base.md.

### GDB-07 Slug rules and derivation
- Behavior: slug must match `^[a-z0-9][a-z0-9-]{0,29}$` (max 30) (error `--slug must match ^[a-z0-9][a-z0-9-]*$ (max 30)`). On `create` the slug is `inp.slug ?? sig.label ?? "<kind>-<key>"` lower-cased, non-alnum runs -> `-`, trimmed, cut to 30, fallback `debug`; collisions (registry slug or existing state file) get `-2`, `-3`... with the base truncated to fit 30. The workflow re-validates the same regex and refuses `failed` without it.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:117-118,585-588; wildera:.agents/workflows/gsd-debug.js:37; upstream slug rule at wildera:.agents/agents/gsd-debugger.md:730
- Why it exists: slugs are interpolated into shell command lines (workflow comment: only validated slugs, UUIDs and a plain drive path are interpolated; JSON goes on stdin) (gsd-debug.js:36).
- Test idea: label `Feeding Drink S30!!` -> `feeding-drink-s30`; a second create with a different signature and the same label -> `feeding-drink-s30-2`; a slug with `;` is rejected by the CLI and the workflow.

### GDB-08 Signature and registry: one session per failure signature
- Behavior: signature = `{kind: scenario|test|crash|build|obligation|other, key (non-empty string), label?}`; id = sha256(JSON `{kind, key.trim()}`). Registry `registry.json` `{version:1, signatures:{id:{slug,status,signature,createdAt,updatedAt,resolvedDigest?}}}`; `setRegistry` merges a patch + `updatedAt` after every status change (create, invocation start, checkpoint, close). A known signature always reuses its slug.
- Proposal: KEEP; the kind list is project-extendable (adapter), `scenario|test|build|crash|obligation` map to the project's verify vocabulary.
- Source: wildera:tools/gsd/debug.mjs:27,126-129,553-557,608-618; wildera:.planning/debug/registry.json:1-30
- Why it exists: compatibility row "A known signature always reuses its session; a resolved one that reappears reopens it" (compatibility.md:98); the same failure went back to coders repeatedly (compatibility.md:97).
- Test idea: `create` twice with the same kind/key -> same slug, `reused:true`; a different kind with the same key -> a new session.

### GDB-09 `debug create` for a NEW signature
- Behavior: reads JSON on stdin `{signature, seenAt[], tasks[], owns[], files[], trigger, symptoms{expected,actual,errors,reproduction,started}, acceptance{signature[],gate[],tests[]}, goal, budget{runs,minutes}, maxTurns, perRunMinutes, slug}`. Builds the session markdown from the first ```markdown block of the vendored upstream `templates/DEBUG.md` (error if absent), filling: status `investigating`, trigger (default `<kind> <key>`, one-lined, JSON-quoted), created/updated, Current Focus fields `none yet`/`gather initial evidence`, symptoms (defaults `not supplied`/`none recorded`/`unknown`), empty root_cause/fix/verification/oracle_type, `## Eliminated` and `## Evidence` replaced with an APPEND-only comment plus a first Evidence entry ("code-wave Verify evidence ... start from these run directories"). Writes state.json v1: slug, signatureId, signature, codeRoot, goal (`find_and_fix` default, or `find_root_cause_only`), status `open`, revision 0, `symptomsSha`, `adapter: wildera-gsd-debug/1`, budget `{runs:12, minutes:120, extensions:[]}`, limits `{maxTurns:16, perRunMinutes:30}`, scope `{owns,files,grants:[]}`, seenAt, tasks, acceptance `{plan, revertRuns (2, or 0 when the signature rerun is a build), attempts:[]}`, invocations/turns/requests/builds/binaries/snapshots/reverts/checkpoints/authorizedDelta empty. Output `{slug, reused:false, path, state:'open', acceptancePlan:n}`.
- Proposal: KEEP; CHANGE the template source to the kit's own copy of the DEBUG.md template shipped with the GSD core; defaults (12 runs, 120 min, 16 turns, 30 min/run) become adapter/config keys (keep values).
- Source: wildera:tools/gsd/debug.mjs:24,590-619,25,27
- Why it exists: DEBUG.md written by create before delegation = upstream debug.md step 3 (compatibility.md:73).
- Test idea: create with minimal input -> md has status investigating, a first Evidence entry, `symptomsSha` stored; missing `acceptance.signature` -> error `acceptance.signature needs at least one typed rerun`.

### GDB-10 `debug create` for a KNOWN signature (reuse, reopen, widen)
- Behavior: unresolved known signature: if `seenAt` supplied, append an Evidence entry ("code-wave Verify", `signature seen again: ...` / `still reproduces`) and bump `updated`; merge new `seenAt` by `maxFps`; widen `acceptance.plan` (deduped by key) and when the plan grew clear `acceptance.passed` and mark an open attempt `abandoned: coverage widened`; union `scope.owns`, `scope.files`, `tasks`. A RESOLVED session (file in `resolved/`) is moved back to the active dir with status `investigating`, an Evidence entry carrying the earlier root_cause/fix ("the earlier fix did not hold or the cause has more than one condition; re-test it first"), state.status `open`, `acceptance.current/passed` cleared, `reopened[]` appended. Attempt tags keep counting (request ids never repeat). `authorizedDelta` and `resolution` are NOT cleared on reopen (GDB-66). Output `{slug, reused:true, reopened, path, state}`.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:559-584
- Why it exists: a reappearing resolved signature must be re-tested, not trusted (comment at :564-570).
- Test idea: close a session resolved, `create` the same signature again -> file back in `.planning/debug/`, `reopened` non-empty, Evidence mentions the earlier fix.

### GDB-11 Session-file validation (`sessionStatus`, `debug status`)
- Behavior: parse the md (CRLF -> LF): frontmatter must parse; `status` in `gathering|investigating|fixing|verifying|awaiting_human_verify|resolved|diagnosed`; `## Current Focus` and `## Symptoms` present; Current Focus `next_action` must not match VAGUE `^(|\[.*\]|continue( investigating)?|investigate( further)?|look at( the)? code|tbd|todo|none|n/a|-|null)\.?$` (i); counts of Evidence (`^- timestamp:`) and Eliminated (`^- hypothesis:`) entries; sha256 of the Symptoms body; Resolution `root_cause|fix|files_changed`. `debug status --slug` exits 0 valid, 1 invalid, 66 no session; additionally adds `Symptoms changed (upstream: immutable after gathering)` when the Symptoms hash differs from state.json's `symptomsSha`. Output also `session{status,revision,goal,budget,checkpoints (unanswered)}`.
- Proposal: KEEP (it makes upstream's prose rules machine-checkable). Note the `resolved: f===mdResolved` flag.
- Source: wildera:tools/gsd/debug.mjs:26,131-137,155-171,621-625; wildera:.agents/agents/gsd-debugger.md:664-678
- Why it exists: upstream "next_action must be concrete and actionable" and "Symptoms IMMUTABLE" (gsd-debugger.md:671,678).
- Test idea: set `next_action: continue investigating` -> status exit 1 with the concrete-action problem; edit Symptoms -> exit 1.

### GDB-12 `debug list` and `debug state`
- Behavior: `list` enumerates `.planning/debug/*.md` except knowledge-base.md (active only, not `resolved/`), returning `{sessions:[{slug,status,hypothesis,next_action}]}`, exit 66 when none. `state` returns the full state.json plus `budgetView`. Every other subcommand except `create|list|lock` requires a valid `--slug` (66 `no debug session <slug>` when state missing).
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:124,546-552,626
- Why it exists: upstream subcommands list/status/continue (wildera:.agents/skills/gsd-debug/SKILL.md:16).
- Test idea: empty dir -> `list` exit 66; two sessions -> both listed with hypothesis/next_action.

### GDB-13 Typed engine requests: fixed allowlist, argv only
- Behavior: an experiment request `{kind: build|test|scenario, ...}` is validated against per-kind field allowlists plus meta fields `kind,hypothesis,expected,purpose,role,label,key`; any other field is refused. build: `target` in `WildEraEditor|WildEra|WildEraServer` (default Editor), optional `noAdaptiveUnity` -> `tools/ue/Build.ps1 -Target T [-NoAdaptiveUnity]`. test: `filter` must match `WildEra(.Id)*(+WildEra(.Id)*)*` -> `tools/ue/Test.ps1 -Filter F`. scenario: `scenario` xor `scenarios` (ids `^[a-z0-9][a-z0-9-]*$`), `keepAlive`, `maxFps 0..1000`, `clients 1..4`, `resX 320..7680`, `resY 200..4320`, `runtimeTimeoutSeconds 10..1800`, `weDevMap DevSlice|DevWorld`, `weDevSpecies` identifier, `netEmulation baseline|adverse|reorder|dup`, `reconnectAfterStep` id, `reconnectDelaySeconds 0..600`, `clientArgs` only `''` or `-csvprofile` -> `tools/ue/Scenario.ps1` with `-Flag value` pairs. A scenario may give a Scenario.ps1 `args` string, parsed token by token against the same flag table (case-insensitive; unknown flag refused; missing value refused). Result `{kind, script, argv, key=JSON([script,...argv]), hypothesis, expected}`; the key dedupes plan items.
- Proposal: CHANGE: the mechanism (typed request kinds, validated fields, argv never interpolated into a shell) is generic and KEEP; the Unreal kinds, flags and ranges move to the project adapter as a declarative experiment-kind table (script, field schema, validators).
- Source: wildera:tools/gsd/debug.mjs:173-227; wildera:.agents/workflows/gsd-debug.js:20-26
- Why it exists: debugger must not run builds itself; "Only the orchestrator or a Verify-like stage builds (AGENTS.md); one Unreal build at a time; bounds enforced in code" (compatibility.md:83).
- Test idea: request `{kind:'test', filter:'WildEra.A; rm -rf'}` -> refused; unknown field `cwd` -> refused; scenario with both `scenario` and `scenarios` -> refused.

### GDB-14 `debug request`: reserve a run against the budget
- Behavior: `debug request --slug S --id ID` with stdin `{request, purpose, turn, expectDigest}`. id `^[a-z0-9][a-z0-9-]{0,63}$`. An existing id returns `{request, existing:true}` (idempotent). Invalid request -> exit 1 `{refused:'invalid', reason}`. `purpose` in `experiment|acceptance|auto-build`. Refused `deadline` when no invocation or the invocation deadline passed. A non-build `experiment` is refused `budget-exhausted` when `used + 1 + reserve > budget`; a non-build `acceptance` run when `used + 1 > budget`; builds are never counted against runs. `expectDigest` (64 hex) binds the run to a tree. Stored `{id, ...typed, purpose, turn, invocation, expectDigest, state:'reserved', reservedAt}`; output includes `budget` view. Request states: reserved, running, completed, uncertain, refused.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:738-758,334-335
- Why it exists: phase 01 wave 3 ran an unbounded loop (about nine rounds on one scenario step) (compatibility.md:84); a resumed workflow never reruns a completed engine run (compatibility.md:100).
- Test idea: budget 6, acceptance plan of 2 non-build items with a non-build signature (reserve = 2 + `revertRuns` 2 = 4): with 2 runs used the next `experiment` request is refused `budget-exhausted` (2 + 1 + 4 > 6); an `acceptance` request at the same point is accepted (2 + 1 <= 6). With a `build` signature `revertRuns` is 0 (debug.mjs:614).
- Note (r1): the revert-and-reconfirm red/green reruns are the first `signature` plan item only (gsd-debug.js:119-127,144-145); if that item is a `build`, they are builds and are not counted against the run budget either way.

### GDB-15 Budget view and defaults
- Behavior: `budgetView` = `{runs:{budget, used (non-refused non-build requests), reserve (= acceptance plan non-build items + revertRuns), acceptanceRuns}, builds (count), wall:{budgetMin, usedMin (sum of invocation segments, open segment counted to now)}, deadlineAt}`. Defaults: 12 runs, 120 min session wall, 16 turns per invocation, 30 min per engine run. Builds cost time, not runs. One acceptance attempt's runs are held back from experiments; an attempt starts only when its whole plan still fits (`acceptance begin` refuses `budget-exhausted` otherwise). Bounds are stored in state.json and kept across invocations; change only with an owner reason.
- Proposal: KEEP; values become config keys with these defaults.
- Source: wildera:tools/gsd/debug.mjs:24,333-345,837-838; wildera:.agents/skills/gsd-debug/SKILL.md:51
- Why it exists: see GDB-14 (unbounded loop incident).
- Test idea: `state` shows `budgetView` consistent with the number of completed non-build requests; a build request does not change `runs.used`.

### GDB-16 `debug run`: build provenance, deadline, detached wrapper
- Behavior: `run --id` on a completed/uncertain/refused request returns `{request, replayed:true}`; on a `running` one waits for the wrapper's result (never relaunches). Otherwise: refused `deadline` if the invocation deadline passed; refused `tree-mismatch: the run is bound to X, the tree is Y` when `expectDigest` differs from the current digest; a non-build request when the state's `binaries.WildEraEditor` is not `ok` for the CURRENT digest returns `{needsBuild:true, digest, binaries}` (exit 0, nothing launched). Otherwise the request is saved as `running` with `startedAt`, `deadlineAt = min(now + cap, invocation deadline)` (cap = `--capMinutes` or `limits.perRunMinutes`, min 0.1 min), `digest`, `log`, and a DETACHED wrapper `node gsd.mjs --root R debug exec --slug --id` is spawned (unref'd, pid saved as `wrapperPid`) BEFORE awaiting its result file. The request is durable as running with its deadline before anything launches.
- Proposal: KEEP the contract (record-then-launch, never launched twice, deadline durable). CHANGE the executor: cross-platform process spawning and a process-tree kill instead of `powershell.exe`/`taskkill`.
- Source: wildera:tools/gsd/debug.mjs:434-437,759-788
- Why it exists: Astra code review 2026-10-19: no relaunch, no lost fix, no held lease after a crash (compatibility.md:101).
- Test idea: kill the workflow after `run` started; resume -> `run` returns the same request once the wrapper wrote its result, with no second engine process.

### GDB-17 Engine execution and result evaluation (`debug exec`)
- Behavior: the wrapper spawns `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <R>/<script> <argv>` with stdout+stderr to the request log; a timer kills the process tree at `deadlineAt`; the child pid is written to `<id>.pid` (failure to record = kill at once). Result `{exit, timedOut, durationMs, passed, reproduces, tail (last 3000 chars of log), treeChangedDuringRun?}`. scenario: result path parsed from the log `Result: <path>/result.json`, result.json and launch.json must be fresher than the start and the launch session must match; validated by `tools/ue/verify.mjs` `scenarioRequest` / `validateScenario` (same evidence contract as the Verify stage); when the parsed request's `fps` > 0 (schema-4 results: each launch's `client.log`; otherwise the single `client.log` next to result.json) every such client.log must be fresh and show `t.MaxFPS=N` and `FrameRateLimit=N` or the result fails with `scenario_fps_not_evidenced`; `summary.txt` tail 1500 chars; `passed = !timedOut && validation passed`. test: the fresh `game/Saved/Logs/WildEra-Test.log` is copied to `<id>.test.log` and parsed by `V.parseAutomation`; a filter that executed no test is not a pass (`unmatched`); `passed = !timedOut && status passed && no unmatched`. build: `passed = exit==0 && !timedOut`. `treeChangedDuringRun` when the digest after the run differs from the one at start. The wrapper writes only the result file (atomic).
- Proposal: CHANGE: generic = fresh-evidence rule, no-test-executed-is-not-a-pass, tree-changed flag, timeout kill; Unreal parsing (Result path, automation log, FPS clamps) belongs to the project adapter validators, which the debug core calls by name.
- Source: wildera:tools/gsd/debug.mjs:470-515
- Why it exists: "scenario/test evidence judged with tools/ue/verify.mjs validators"; stale or unrelated records must not certify causality (compatibility.md:103).
- Test idea: a test run whose log predates the start is not `passed`; a filter matching zero tests gives `unmatched` and `passed:false`.

### GDB-18 `reproduces`: positive evidence of the signature itself
- Behavior: `result.reproduces` is true/false/null: false whenever `passed !== false` (a passed run, or `passed` null); scenario signatures match the key suffix `#<step>-<name>` against `step <n> '<name>'` in the summary + log; test signatures match a failure name equal to the key or prefixed `key.` (no match = false, not null); crash signatures need `=== Critical error: ===` in the test text and every recorded reason line (crash-folder suffix stripped) present; build signatures need a log line that contains the key after `\` -> `/` and matches `/[:)]\s*(?:fatal )?error\b/i`; obligation (missing-test) signatures reproduce only when a complete fresh run (one discovery, queue empty with equal counts, all discovered tests terminated) again executes nothing for one of the filters; a run without that evidence returns null. null is returned for: a scenario key without a `#<step>-<name>` suffix, any signature/request kind pair not listed, and the obligation early exits (no filters, no test log, no automation result, or timed out — obligation is the only kind that returns null on timeout). Crash matching strips a leading `the test process crashed:` and a trailing ` (token)` from the key, splits on ` | `, and compares whitespace-collapsed lines.
- Proposal: KEEP the principle (revert-and-reconfirm needs the signature itself, "another failure does not count"); the per-kind matchers become adapter-supplied.
- Source: wildera:tools/gsd/debug.mjs:444-469; wildera:.agents/skills/gsd-debug/references/adapter.md:44
- Why it exists: unrelated failures must not certify causality (compatibility.md:103).
- Test idea: revert run fails with a different test name -> `reproduces:false`, acceptance ends `unverified`, not passed.

### GDB-19 Result folding, uncertain runs, binary provenance
- Behavior: `complete()` folds the result file into the request (`state:'completed'`, `endedAt`); a build request updates `binaries[target] = {digest, ok: passed && !treeChangedDuringRun, request, at}`. `awaitResult` polls the result file every 2 s up to the request deadline + 120 s; if absent it stops the process tree and marks the request `uncertain` (`passed:null`, reason `no result by the run deadline; its process tree was stopped`). Only a NEW invocation record clears `binaries` (they may have been rebuilt from another tree); a resumed invocation (same id) returns before that point (debug.mjs:637-642 vs 674-676), keeping the recorded binaries, the status and the goal. Tests/scenarios run only on a WildEraEditor build of the current digest (the workflow builds first as an `auto-build` request `<id>-b`).
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:516-533,674-676,769-772; wildera:.agents/workflows/gsd-debug.js:74-88
- Why it exists: "Build provenance (C5)" comment :769; binaries may have been rebuilt by a code-wave Verify (:674).
- Test idea: change a source file after a build; the next test request returns `needsBuild` and the workflow issues `<id>-b` first; if the tree changes during that build, the run returns `error` "the build did not cover the current tree".

### GDB-20 Invocation start/end (lease-bound, resumable, budget extension)
- Behavior: `debug invocation start --id <uuid> --token T` requires the lock held with the same slug/root/token. Existing invocation id -> `{resumed:true, invocation, status, goal, budget, answered}` and a closed segment is reopened (the time it lay dead is not charged; deadline kept). New: refuse `resolved` sessions (`refused:'resolved'`); an unanswered checkpoint requires stdin `checkpointAnswer {id, response (non-empty)}` else `refused:'awaiting-owner'` with the checkpoint; for `budget-exhausted|deadline|turn-cap` checkpoints an answer alone is refused `refused:'budget'` unless `budgetExtension {runs>=0, minutes>=0, reason non-empty}` is given (reason required); the answer is stored `{response, acceptDebt, confirmed, at}` and appended to `## Checkpoints` as `answered:` + `response: | DATA_START ... DATA_END`; the extension adds to `budget.runs/minutes` and is recorded with timestamp and invocation. An earlier invocation that never ended is charged only up to its last recorded activity (turn/request timestamps), outcome `interrupted`. Refused `budget` when wall budget spent — NOTE the order: a matching checkpoint answer is already written to the md before this check and state is not saved on the refusal (GDB-60). New record `{id, startedAt, segments:[{start,end:null}], deadlineAt = now + remaining minutes, answer}`; `status:'open'`; goal may be set (`find_root_cause_only|find_and_fix`). `invocation end` closes the open segment with `--outcome` (default `ended`).
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:627-679,332; wildera:.agents/skills/gsd-debug/SKILL.md:57
- Why it exists: "an answer alone never refills the budget" (SKILL.md:57); runner-death accounting comment :662.
- Test idea: answer a `budget-exhausted` checkpoint without `budgetExtension` -> refused `budget`; with extension of 5 runs/30 min -> accepted and `budget.runs` grows by 5.

### GDB-21 Replay-safe turns (`turn begin|end|decide`)
- Behavior: key = `<invocationId>:<index>`. `begin`: an existing turn returns its stored prompt, result, decision and time window (`state` `begun`/`ended`); a new one refuses `deadline` after the invocation deadline and `turn-cap` when index >= `limits.maxTurns`; otherwise renders the prompt (GDB-23), writes `.planning/debug/<slug>/turns/<inv8>-<k>.prompt.md`, stores `{inv,index,kind,prompt,startedAt,digestBefore,revision}`. `end` stores `{endedAt, result, digestAfter}` once (second call returns the stored result) and returns the window `{since, until}` (ms). `decide` stores the workflow's decision (`{c, next}` counters + next prompt input) exactly once so a replay repeats it. The workflow, on replay, reuses a stored decision instead of calling the agent again.
- Proposal: KEEP (replay-safety through persisted prompt/result/decision is the core of crash-safe orchestration). CHANGE: with `ph`/Paseo as runtime, the "replay" boundary is the orchestrator process, not the native Workflow resume; keep the persisted records.
- Source: wildera:tools/gsd/debug.mjs:680-716; wildera:.agents/workflows/gsd-debug.js:198-217
- Why it exists: compatibility row "Replay-safe turns and requests ... A resumed workflow never reruns a completed engine run or repeats a turn (C3)" (compatibility.md:100).
- Test idea: run turn 0 to `end`, kill, resume with the same invocation: the agent is not spawned again and the stored result is used.

### GDB-22 Prompt per turn: upstream manager text + `<runtime_adapter>` block
- Behavior: the prompt is the upstream session manager's Step 2 (spawn/resume) or Step 3d (checkpoint continuation) ```markdown block from `agents/gsd-debug-session-manager.md`, with `{if key: "..."}` conditionals and `{slug|debug_file_path|symptoms_prefilled|goal|resume_status|resume_next_action|checkpoint_type|user_response}` filled (symptoms_prefilled always `true`, tdd off). CAVEAT (r1, GDB-62): only the Step 2 block carries `{goal}` and `{symptoms_prefilled}`; the Step 3d block hardcodes `goal: find_and_fix`; then workflow `blocks` each wrapped `<tag>\nDATA_START\n...\nDATA_END\n</tag>`, then `<runtime_adapter>` with adapter_version `wildera-gsd-debug/1`, state_revision, tree_digest, code_root (all repository paths resolve there, `.planning/debug/` inside it), turn kind/index of max, budget line (runs used/budget, reserved, builds, wall, deadline), edit_scope (`owns`, `files + grants`, never shared files) and, for `find_root_cause_only`, `product-read-only: do not change any file outside .planning/debug/`. `managerTemplates` throws if the upstream anchors (`## Step 2: Spawn gsd-debugger Agent`, `### 3d. CHECKPOINT REACHED`) or required placeholders are missing; `port.mjs check` runs it.
- Proposal: CHANGE: keep the idea (render from the vendored upstream manager text so the method stays upstream) but the new kit ships the GSD core, so the template lives in the kit with a test that its placeholders exist; the `runtime_adapter` block fields are the contract between workflow and agent.
- Source: wildera:tools/gsd/debug.mjs:952-997; wildera:tools/gsd/port.mjs:196-197; wildera:.agents/skills/gsd-debug/references/adapter.md:7
- Why it exists: "Keep GSD's ideas intact; change only the adapter" (wildera:_workspace/gsd-port/DESIGN.md:10-12).
- Test idea: render a `checkpoint` turn -> contains the owner response between DATA_START/DATA_END and the runtime block with the current tree digest; remove the anchor from the template -> build/check fails.

### GDB-23 Checkpoints (owner questions) and their types
- Behavior: `debug checkpoint` (stdin `{type, question, options, key, invocation}`) appends `{id: ck-N, key, type, question, options, at, invocation}`; an unanswered checkpoint with the same `key` is returned as `existing:true` (idempotent per `<invocation>:<turn>:<type>`). State `status` becomes the type for `budget-exhausted|deadline|turn-cap`, else `needs-owner`; the registry is updated; the question is appended to the md `## Checkpoints` as `- id/type/raised/question: | DATA_START ... DATA_END [options: JSON]`. Types used by the workflow: `deadline`, `turn-cap`, `budget-exhausted`, `violation`, `scope`, `decision`, `human-verify`, `human-action`, `inconclusive`, `guardrail`, `acceptance`, `blocker`. The owner answer arrives on the NEXT invocation (new UUID) as `checkpointAnswer {id, response, acceptDebt?, confirmed?}`; the workflow never waits or asks inside a run.
- Proposal: KEEP (needs-owner stop + answer-on-next-invocation fits unattended Paseo workers); the owner is asked in plain text by the main session.
- Source: wildera:tools/gsd/debug.mjs:717-729,649-659; wildera:.agents/workflows/gsd-debug.js:64,296-301; wildera:.agents/skills/gsd-debug/SKILL.md:57
- Why it exists: "Workflows run unattended; owner questions in plain text" (compatibility.md:88).
- Test idea: raise the same checkpoint twice in one turn -> one record; start the next invocation without an answer -> `refused:'awaiting-owner'`.

### GDB-24 DATA_START/DATA_END markers for untrusted text
- Behavior: owner responses, checkpoint questions, experiment results and acceptance results enter prompts and the session file between `DATA_START`/`DATA_END` and are evidence, never instructions; the debugger prompt repeats it; reproduction scripts from reports are not executed.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:657,726,964; wildera:.agents/skills/gsd-debug/references/adapter.md:49; wildera:.agents/agents/gsd-debugger.md:37
- Why it exists: upstream SECURITY note on user-supplied evidence (gsd-debugger.md:37).
- Test idea: an owner answer containing "ignore previous instructions" appears only inside DATA_START/DATA_END in the next prompt.

### GDB-25 `debug grant`: scope extension by the main session
- Behavior: `debug grant --slug S --paths a,b` adds exact repo-relative paths to `scope.grants`; refuses empty lists, `..`, absolute paths and any shared file (`ctx.isShared`). Main session only, after the owner agrees to a `scope` checkpoint. A grant inside a later wave's owns means re-checking those plans against WIRING.md before that wave.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:730-737; wildera:.agents/skills/gsd-debug/SKILL.md:57
- Why it exists: edit scope belongs to the parallel ownership model (compatibility.md:90).
- Test idea: `grant --paths game/Config/DefaultEngine.ini` -> refused; `grant --paths a/b.cpp` -> listed in `grants` and accepted by `delta`.

### GDB-26 Edit scope and the fix delta
- Behavior: the debugger may change only: `scope.owns` prefixes (the signature tasks' owns via `ctx.ownedPrefixes`), exact `scope.files` (evidence files) and `scope.grants`; never a shared file. The check is `ctx.isShared` = regex `/\.(Build\.cs|Target\.cs|uproject|uplugin|ini)$/i` on the path (so ANY `.ini`), or `^game/(?:.+/)?Config(?:/|$)` (Config is shared only under `game/`) (wildera:tools/gsd/gsd.mjs:463-465, outside my scope, read in r1); `grant` and `delta` use this function, while the prompt text (`Config/`) is wider than the check. `ctx.ownedPrefixes` (Module:Folder -> Public/Private, `Content:`, `Path:`) throws on a bad entry; a throw inside `delta` is a non-zero exit, which the workflow treats as a scope stop (gsd-debug.js:225). `delta` = paths whose content differs between the latest snapshot and now (an absent path vs a HEAD-equal one compared as `head`); `debug delta` -> `{snapshotDigest, digest, headMoved, paths, outOfScope, shared}`, exit 1 if HEAD moved or anything is out of scope. A needed path outside the scope is a `SCOPE REQUEST` return that stops the session for the owner. Diagnose-only sessions (`find_root_cause_only`): ANY product delta stops the session.
- Proposal: KEEP; the shared-file list and the owns grammar come from the project adapter / plan ownership model.
- Source: wildera:tools/gsd/debug.mjs:242-251,811-814; wildera:.agents/skills/gsd-debug/references/adapter.md:36; wildera:.agents/workflows/gsd-debug.js:224-229
- Why it exists: parallel ownership model; a dirty wave tree holds other tasks' uncommitted work (compatibility.md:86,90).
- Test idea: the debugger edits a file outside owns after a turn -> workflow ends `needs-owner` (`scope`) with a `violation` checkpoint; goal diagnose-only plus any edit -> same.

### GDB-27 Snapshot (baseline) outside the worktree, ensure semantics
- Behavior: `debug snapshot` takes a baseline of the evaluated tree: copies every changed/untracked file (`entries` with a hash) into `%LOCALAPPDATA%/WildEra/gsd-debug/<sha12(root)>/<slug>/snap-N/files/`, saves `git diff --binary --cached` as `staged.patch`, writes `meta.json` `{n, codeRoot, at, digest, head, entries, dir, staged}`. Ensure semantics: an existing snapshot is kept (`existing:true`) unless HEAD moved, the session was reopened after it, or `--new`; otherwise a new one is taken (`rebased:true` if there was one). The baseline is kept across invocations (a fix may span an owner checkpoint). The workflow takes it before the first writable turn so instrumentation is part of the fix delta. `delta` throws `no snapshot: take one before the first writable turn` (66) without one. HEAD moved since the snapshot = delta undefined.
- Proposal: CHANGE: store outside the worktree under a per-machine data dir (not hardcoded `WildEra`, not LOCALAPPDATA only); keep the rules. OPEN: git-based alternative (hidden ref / `git stash create` object) instead of file copies.
- Source: wildera:tools/gsd/debug.mjs:28,123,229-241,802-810; wildera:.agents/workflows/gsd-debug.js:173-176
- Why it exists: replaces `git stash`; a dirty wave tree holds other tasks' uncommitted work (compatibility.md:86).
- Test idea: dirty tree with another task's edits; snapshot; debugger edits file X; `delta` lists only X; a new snapshot after a commit has `rebased:true`.

### GDB-28 Revert and reapply as recorded transactions
- Behavior: `debug revert --id R` reverts ONLY the fix delta to the snapshot content (HEAD content for a path the snapshot did not have, deletion for new files). Preconditions: HEAD unmoved, delta non-empty, no out-of-scope change (`refusing to revert a tree someone else changed`). Before any file changes: per-path pre-revert content is copied to `snap-N/revert-<id>-<ts>/files/`, `meta.json` and the state record `{state:'reverting', paths, saved, fixSha, targets, fixDigest, snapshotDigest, save}` are durable; targets (snapshot hash, HEAD-with-filters hash, or absent) are recorded up front so recovery recognises a reverted path. A retry finishes the recorded path list (each restore idempotent); a path whose content is neither fix nor target = an intervening edit: stop with both versions kept, backup never overwritten. After restoring, the tree digest must equal the snapshot digest or it errors naming the saved fix. State `reverted`. A finished `reapplied` revert of the same id at the fix digest may be reverted again (acceptance retry). `reapply` restores saved fix contents, refuses on conflicts (nothing overwritten), checks the digest equals the fix digest, state `reapplied`. `recover` (before writable turns/acceptance) re-applies every non-`reapplied` revert.
- Proposal: KEEP (this is the strongest part of the old design); implement against the new digest and snapshot store.
- Source: wildera:tools/gsd/debug.mjs:266-331,789
- Why it exists: Astra review: no lost fix after a crash (compatibility.md:101); `git stash` is never used (wildera:.agents/skills/gsd-debug/references/adapter.md:39).
- Test idea: kill the process between the backup and the restore of the second path; `debug recover` reapplies the fix; digest equals the pre-revert fix digest and no saved backup is deleted.

### GDB-29 `debug audit`: the debugger must not run engines itself
- Behavior: `debug audit --since ms --until ms` scans `game/Saved/Logs/*.log` (top level) and `_workspace/scenario/run-*` dirs for artifacts whose mtime lies in the turn window; any hit -> exit 1 `{clean:false, engineArtifacts}`. The workflow runs it after every turn; a hit ends `needs-owner` with a `violation` checkpoint ("Its evidence bypassed the budget and the lease"). Read-only commands (git log/diff/grep, lints, nvidia-smi query) are allowed to the debugger.
- Proposal: KEEP the rule; the watched paths come from the adapter.
- Source: wildera:tools/gsd/debug.mjs:790-801; wildera:.agents/workflows/gsd-debug.js:219-223; wildera:.agents/skills/gsd-debug/references/adapter.md:24
- Why it exists: "The debugger never launches engines itself (C3)" (comment :791); only the workflow builds.
- Test idea: touch a `Saved/Logs/x.log` during a fake turn window -> audit exits 1; outside the window -> 0.

### GDB-30 Acceptance plan and attempts (`debug acceptance begin|step|end`)
- Behavior: plan items are typed and deduplicated by key: `acceptance.signature[]` (the signature rerun at every frame-rate edge seen), `acceptance.gate[]` (the wave's gate scenarios), `acceptance.tests[]` (touched capability filters). At least one `signature` item is required. `begin`: first `recover`; refuse `stop` on HEAD moved or out-of-scope delta; `empty:true` when the delta is empty; `reuse` of a previously passed attempt for the same digest and plan key; resume an unfinished attempt for the same digest (a red run counted again only when it did not complete on the reverted tree); abandon an attempt whose tree changed; refuse `budget-exhausted` when the whole plan does not fit; new attempt `{n, tag a<n>, planKey, digest, snapshotDigest, delta, redTry, red, green, verdict, at}` (seq never repeats). `step` stores red/green once; `end` stores `{verdict, runs, guardrail, endedAt}`, pushes to attempts and sets `acceptance.passed` for `passed`.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:535-544,817-854
- Why it exists: "One acceptance attempt is a transaction bound to the fix digest" (comment :818); acceptance evidence bound to its digest (compatibility.md:103).
- Test idea: kill mid-attempt, rerun `begin` on the same tree -> `resumed:true` with the same tag; change a file -> old attempt `abandoned: the tree changed`.

### GDB-31 Workflow acceptance procedure and guardrail mapping
- Behavior: `acceptance(debt)`: (a) every plan item runs as an `acceptance` request `<tag>-<i>` bound to the fix digest; each must be `completed`, `passed`, digest == fix; first failure ends the attempt `failed` with a description and earlier run records. (b) unless the owner accepted debt, revert-and-reconfirm (upstream signal 5, Agans rule 9): `revert --id <tag>-rv-<redTry>`, rerun the FIRST `signature` plan item only (not every frame-rate edge; later signature items are covered only by step (a)) bound to the snapshot digest, `reapply`; the red run must be `completed` on the snapshot digest with `reproduces === true`. If the run passed (bug did not return) -> verdict `rejected` with guardrail `revert_and_reconfirm: fail` -> `FIX REJECTED BY GUARDRAIL` to the owner; any other inability (could not run, failed with another failure) -> verdict `unverified` (`cannotVerify`, never passed). Then green: the signature again on the fix digest after reapply; failing = `failed` ("unstable"). Revert failure/reapply failure -> stop (the fix is saved in the revert record). (c) the digest must still equal the fix digest at the end (`the tree changed during acceptance`). Guardrail record: `target_test: pass`, `mutation_check: skipped: no mutation tool configured for Unreal C++`, `no_op_deletion: assessed by the debugger`, `adjacent_tests: pass|skipped: no touched-capability tests named`, `revert_and_reconfirm: pass|accepted_debt`, `guardrail_verdict: accepted|accepted_debt`. A signal that cannot run is skipped with a reason, never passed.
- Proposal: KEEP the procedure and the "cannot verify is not a pass" rule; mutation check reason becomes project-config (a mutation tool may exist for other languages).
- Source: wildera:.agents/workflows/gsd-debug.js:97-160; wildera:.agents/skills/gsd-debug/references/adapter.md:39,44; wildera:.agents/skills/gsd-plan/references/compatibility.md:76
- Why it exists: upstream fix-acceptance guardrail; a bug that does not return on revert means the fix was not causal; compatibility.md:76,103.
- Test idea: scripted run where the signature stays green on revert -> result `needs-owner` type `guardrail` with options revise / accept as technical debt / abandon; with `acceptDebt:true` on the next invocation the revert check is skipped and `guardrail_verdict: accepted_debt`.

### GDB-32 Close: resolved vs diagnosed, knowledge base
- Behavior: `debug close --outcome resolved|diagnosed` (idempotent when already in that status). `diagnosed`: frontmatter status `diagnosed`, state `diagnosed`, registry updated (file stays active, never `resolved/`). `resolved` requires stdin `acceptance.passed` and `acceptance.digest` equal to the CURRENT tree digest (else error); appends `## Acceptance` (timestamp, tree_digest, code_root, runs, guardrail), moves the file to `resolved/<slug>.md`, appends one knowledge-base entry `## <slug> — <oneLine>` with Date, Error patterns, Root cause(s), Fix, Files changed (Resolution or the delta), Why not caught, Recurrence guard (from the debugger's `prevention` block; `not recorded` defaults), creating the file with the hardcoded upstream header text (debug.mjs:875, not read from a template) when absent. Append rule (debug.mjs:877-878): the entry is appended when the file has no `\n## <slug> — ` heading yet OR the session has ever been reopened (`st.reopened` non-empty); a never-reopened session whose heading already exists is not written again. Nothing rewrites or deletes an earlier entry, so a reopened session that resolves again leaves BOTH entries; stores `resolvedAt`, `resolution{digest,at}`, adds the delta to `authorizedDelta` (consumed by `reconcile check`), registry `resolvedDigest`. No commits (the orchestrator commits when asked). `diagnosed` is never a fix authorization.
- Proposal: KEEP.
- Source: wildera:tools/gsd/debug.mjs:855-883; wildera:.agents/agents/gsd-debugger.md:994-1018; wildera:.agents/workflows/gsd-debug.js:262-266
- Why it exists: upstream archive_session / knowledge_base_protocol; the wave tree reconciliation must not flag the fix delta as foreign (comment :80).
- Test idea: close resolved with acceptance digest != current tree -> error; after a valid close the md is in `resolved/`, KB has one entry for the slug, and `reconcile check` accepts the delta paths.

### GDB-33 Machine-wide lease (`debug lock ...`)
- Behavior: lock file `%LOCALAPPDATA%/WildEra/gsd-debug.lock` (tmpdir fallback), one machine-wide lease. `acquire --slug --invocation <uuid>`: if held by the same invocation/root/slug -> resumed (lease renewed, same token); held by another -> exit 1 `{acquired:false, reason:'locked', holder, runnerAlive, leaseExpired}`; free -> create with `wx` (race loser gets `locked (lost the create race)`), written first as `phase:'pending'` (code-wave and gsd-plan admissions in that root are refused from then on), then `writers()` is checked; any active writer removes the lock and returns `writers active`; else `phase:'active'` and a 32-char token. Lease 45 min, `renew --token` extends it (the workflow renews every turn). `release --token` removes it (token must match). `check` -> exit 1 `{locked:true,...}` when a lock exists for this root (used by code-wave/gsd-plan admission). `status` -> holder plus `runnerAlive`, `leaseExpired`, running engines with liveness, `supervisorAlive`, `stale` (runner dead + lease expired + no live engine). `clear --slug <holder>` (main session only): refused while the runner, the lease or any engine lives; the slug confirms which session was inspected. Lock record fields: GDB-68. The runner pid is the grandparent (`Get-CimInstance Win32_Process` of the CLI's parent).
- Proposal: KEEP the semantics (pending-then-quiesce-then-active, token-checked release, stale-only clear). CHANGE the lease location/holder identity: per-project dir or a Paseo agent id instead of a Windows CIM walk; drop the "machine-wide across all roots" rule unless a second root can share the engine (OPEN).
- Source: wildera:tools/gsd/debug.mjs:28-29,347-432; wildera:.agents/skills/gsd-debug/SKILL.md:38,58
- Why it exists: phase 01 W3 had a debugger and waves in the same tree (compatibility.md:92).
- Test idea: two acquires with different invocation ids -> second gets `locked`; kill the runner and let the lease expire -> `status.stale` true -> `clear` with the right slug succeeds, with a wrong slug throws.

### GDB-34 Writer quiescence check
- Behavior: `writers(ownPid, ownSlug)` lists blocking writers: workflow runs in `_workspace/_runs/*/run.json` (modified within 7 days, `status:'running'`, pid alive, not own) — a `gsd-debug` run unless its `args.slug` equals this session (so another slug blocks machine-wide); `code-wave` only when its root `path.resolve(HARNESS, args.cwd ?? '.')` equals the debug code root; `gsd-plan` and `gsd-verify` only when `ctx.HARNESS` (the kit checkout, NOT `ctx.ROOT`) equals the debug code root; any workflow name outside `code-wave|gsd-plan|gsd-verify|gsd-debug|gsd-research|review-gate` blocks regardless of root; `gsd-research` and `review-gate` never block. A run whose `run.json` pid is the runner's own pid is skipped (debug.mjs:359). Running run.json has no name yet, so the script basename identifies the workflow. Paseo agents (`paseo ls --json`, status running, name not containing own slug) block when named `code-wave:|gsd-plan:|gsd-debug:` or matching `/coder|debugger|fixer/i` — Paseo does not apply an agent's cwd, so any such live agent blocks whatever its root. If `paseo ls` fails the check reports `cannot list Paseo agents ...; writer quiescence is unverified` (blocks).
- Proposal: CHANGE: query the kit's own agent registry (`ph`) with a structured role/workspace field instead of name regexes; keep fail-closed when unverifiable.
- Source: wildera:tools/gsd/debug.mjs:353-379
- Why it exists: same incident as GDB-33; Paseo not applying agent cwd (comment :370).
- Test idea: with a fake running coder agent the acquire returns `writers active` and leaves no lock behind; with `paseo ls` failing it still blocks.

### GDB-35 Deadline supervisor (`debug supervisor` / `supervise` / `deadline`)
- Behavior: after invocation start the workflow starts a detached supervisor (`node gsd.mjs ... debug supervise --token --inv --until <deadline>`), whose pid is stored in the lock. It polls (<= 20 s): lease released/changed hands -> exits; runner pid dead -> stops engine trees, if all gone closes the invocation segment (`interrupted`) and releases the lease, else keeps the lease and reports `kept: workers still alive`. At the deadline it stops every `running` request (wrapper and engine trees), archives `paseo` agents named `gsd-debug:*<slug>*` that are running, writes `<slug>/deadline.json {invocation, at, until, killed, archived, stillAlive}`, gives a live workflow 10 min to record the checkpoint and release itself, otherwise finalizes: closes the segment `deadline`, adds a `deadline` checkpoint (key `<inv>:deadline`), status `deadline`, releases the lease. A worker that survives the stop keeps the lease (ownership released only after workers are gone); an unverifiable Paseo listing counts as a living worker (GDB-64). `debug deadline` returns `{expired, ...}` only when bound to the CURRENT invocation (an earlier invocation's expiry never stops a later, extended one).
- Proposal: KEEP (turns "enforced in code" into a real process boundary); agent archival goes through the kit's `ph`.
- Source: wildera:tools/gsd/debug.mjs:884-948; wildera:.agents/workflows/gsd-debug.js:65-70
- Why it exists: unbounded engine/agent time; a dead runner must not hold the lease (compatibility.md:101).
- Test idea: spawn a supervisor with `--until` 5 s away and a sleeping fake engine request: after the deadline the engine tree is dead, `deadline.json` exists, a `deadline` checkpoint exists and the lock file is gone.

### GDB-36 Workflow args and preconditions
- Behavior: `args` = `{slug, invocationId (uuid), codeRoot (absolute drive path without `"%&|<>^!`), debuggerModel (default `circle/gpt-6.1-sol[1m]`), debuggerEffort (default `high`), perRunMinutes (default 30; only the workflow's wait for `debug run`, see GDB-61), checkpointAnswer, budgetExtension, goal, prevention}`. Invalid slug/UUID/codeRoot -> `{status:'failed', reason}` with no side effects. The slug comes from `debug create` run by the main session before delegation. The UUID must be new per invocation and kept only for `--resume`. All CLI calls go through `shell('node tools/gsd/gsd.mjs --root "<codeRoot>" ...')`, JSON on stdin, last stdout line parsed as JSON, only validated values interpolated.
- Proposal: CHANGE: model/effort come from the adapter's per-role models; path validation becomes cross-platform; keep the "nothing unvalidated reaches a shell" rule.
- Source: wildera:.agents/workflows/gsd-debug.js:34-50
- Why it exists: workflow comment :36 (cmd.exe injection surface).
- Test idea: args with `slug: "a;b"` -> `failed`, no lock created.

### GDB-37 Workflow startup sequence
- Behavior: (1) `lock acquire` -> `busy` (with details) when not acquired. (2) `invocation start` (stdin `{checkpointAnswer, budgetExtension, goal}`); refusal -> `resolved` for a resolved session else `needs-owner`. A replay of an invocation that already closed the session returns that terminal outcome. (3) start the supervisor (failure = `failed`). (4) `recover` an interrupted revert (failure = `needs-owner`). (5) `snapshot` (failure = `failed`). (6) if the answered checkpoint was `human-verify` with `confirmed` and a passed acceptance exists, `acceptance begin`: when it returns `reuse` (same digest and plan) close `resolved` without new runs ("owner confirmed the feel/visual truths"), else log and continue the session. (7) first turn kind: `checkpoint` (answer present), `resume` (turns exist), else `spawn`. Whole body in try/catch: any exception ends `failed` and releases the lease.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:53-56,162-197,317-318
- Why it exists: lease released on every exit (comment :317).
- Test idea: kill after step 4 and rerun with the same UUID: no second snapshot taken (existing), no second invocation record.

### GDB-38 Per-turn loop: spawn, audit, scope, session-file check, one repair turn
- Behavior: each turn: renew lease; `turn begin`; replay a stored decision if present; else spawn the `gsd-debugger` agent (label `Debug:<slug>`, persistent session `debugger:<slug>`, model/effort from args, JSON schema DEBUGGER, cwd = codeRoot) and `turn end`. Then: deadline flag -> `deadlineStop`; `audit` (violation -> needs-owner); `delta` (HEAD moved, out-of-scope, or any product delta in diagnose-only -> needs-owner `scope` + `violation` checkpoint "Revert or authorize (debug grant) and continue"); `status` validity: problems plus Evidence/Eliminated shrinking below the previous count (append-only) plus a session moved to `resolved/` by the debugger. Problems -> exactly one repair turn (resume with a `session_file_repair` block listing them); still invalid -> `failed`. `turn begin` refusals and replayed decisions: GDB-65. Counters `c = {autoResumes, unchanged, pre, rootCause, repair, evidence, eliminated}` are persisted with each decision.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:198-241
- Why it exists: upstream "update the file BEFORE taking action"; session file is the debugger's brain (wildera:.agents/agents/gsd-debugger.md:676-698).
- Test idea: a fake debugger that deletes an Evidence entry gets one repair turn; if it repeats, result `failed` with `session file still invalid after a repair turn`.

### GDB-39 Return markers and routing table
- Behavior: debugger returns JSON `{marker, summary, checkpointType?, question?, experiment?, scope?, ownerOnly?, prevention?, filesChanged?}`; markers `ROOT CAUSE FOUND, DEBUG COMPLETE, CHECKPOINT REACHED, INVESTIGATION INCONCLUSIVE, FIX REJECTED BY GUARDRAIL, TDD CHECKPOINT, CONTINUE_REQUIRED, EXPERIMENT REQUEST, SCOPE REQUEST`. Routing: `EXPERIMENT REQUEST` -> run it (GDB-40); `ROOT CAUSE FOUND` -> GDB-41; `DEBUG COMPLETE` or `CHECKPOINT REACHED` with `checkpointType human-verify` -> acceptance (GDB-31, GDB-42); `CHECKPOINT REACHED` (other types), `INVESTIGATION INCONCLUSIVE` (options: continue investigating / add more context / stop), `FIX REJECTED BY GUARDRAIL` (revise / accept as technical debt / abandon), `SCOPE REQUEST` (type `scope`, "Grant exact paths (gsd.mjs debug grant)") -> `needs-owner` with a checkpoint; anything else (`CONTINUE_REQUIRED`, `TDD CHECKPOINT`, unrecognized, null) is non-terminal -> auto-resume (GDB-43). Upstream asks checkpoints through the session manager; here the workflow records them.
- Proposal: KEEP; drop `TDD CHECKPOINT` from the enum if TDD stays unsupported (it falls into auto-resume today).
- Source: wildera:.agents/workflows/gsd-debug.js:11-32,245-313; wildera:.agents/skills/gsd-debug/references/adapter.md:16-20
- Why it exists: "Put the upstream return heading without `## ` in marker" (adapter.md:16).
- Test idea: feed each marker through a fake debugger and assert the status and checkpoint type per the table.

### GDB-40 `EXPERIMENT REQUEST` handling
- Behavior: refused (re-spawn with an `experiment_refused` block, no run) when Current Focus `test` or `expecting` is vague (`none yet|tbd|-|n/a|empty`): the request must be recorded in the session file first. Otherwise `engine(id = x-<inv8>-<turn>, ...)`: reserve, run, auto-build when binaries are not for this tree (a failed build reports `buildFailed`); `budget-exhausted` -> `needs-owner` checkpoint "Extend the budget (budgetExtension with a reason) or stop"; `deadline` -> deadline stop; a refusal is reported to the debugger as `Request refused (...) Nothing ran`. The next turn (kind `spawn`, i.e. a fresh continuation prompt) carries an `experiment_result` block: record id, kind, script+argv, state, exit, passed, timedOut, reason, duration, log paths, scenario result/validation/summary, automation JSON, `tree_digest`, tail (1500 chars). One experiment per turn.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:89-95,247-261; wildera:.agents/skills/gsd-debug/references/adapter.md:26-32
- Why it exists: upstream "update the file before taking action" (adapter.md:30).
- Test idea: request an experiment while `test: none yet` -> no run reserved; request with a recorded focus and 0 runs left -> `needs-owner` `budget-exhausted`.

### GDB-41 `ROOT CAUSE FOUND` under each goal
- Behavior: `find_root_cause_only`: `close --outcome diagnosed`, result `diagnosed` ("never a fix authorization"). `find_and_fix` (the standing answer to upstream's "fix now?"): next turn gets a `fix_authorization` block; a second consecutive ROOT CAUSE FOUND without a fix -> `needs-owner` `decision` checkpoint (options fix now / plan fix / manual fix). The counter resets on any other marker.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:246,262-274; wildera:.agents/agents/gsd-debugger.md:1113-1134
- Why it exists: compatibility row "`find_and_fix` is the standing 'fix now'; a second ROOT CAUSE FOUND without a fix stops" (compatibility.md:88).
- Test idea: fake debugger returns ROOT CAUSE FOUND twice under find_and_fix -> `needs-owner`, checkpoint type `decision`.

### GDB-42 Resolution path: machine acceptance vs owner confirmation
- Behavior: owner decision 2026-10-19 (choice a): after `DEBUG COMPLETE`/human-verify the workflow runs acceptance; when it passes and the debugger's `ownerOnly` list is empty the session closes `resolved` on machine evidence alone; if `ownerOnly` (feel/visual truths no scenario can observe) is non-empty the result is `needs-owner` with a `human-verify` checkpoint listing them, and the owner's `confirmed:true` on the next invocation closes on the recorded acceptance with no new runs (if the tree is unchanged). Acceptance outcomes: `passed`; `refused deadline` -> deadline stop; other refusals/`stop`/`cannotVerify`/`rejected` -> `needs-owner` (types `budget-exhausted`|`guardrail`|`acceptance`); `failed` -> next turn gets an `acceptance_result` block, "status returns to investigating". Result statuses of the workflow: `resolved`, `diagnosed`, `needs-owner`, `busy`, `failed`.
- Proposal: KEEP; the owner decision is in force unless revoked.
- Source: wildera:.agents/workflows/gsd-debug.js:275-295,179-190; wildera:.agents/skills/gsd-debug/references/adapter.md:41; wildera:.agents/skills/gsd-plan/references/compatibility.md:85
- Why it exists: owner decision 2026-10-19 (adapter.md:41, compatibility.md:85).
- Test idea: acceptance passes with `ownerOnly: []` -> `resolved` without any checkpoint; with `ownerOnly:['feel']` -> checkpoint `human-verify`; answer `confirmed:true` -> `resolved`, zero new engine runs.

### GDB-43 Auto-resume guard for non-terminal returns
- Behavior: a non-terminal return (or `null`, with log `the debugger returned nothing`) is resumed with the recorded status and `next_action` (upstream #3448). Stop with `needs-owner` `blocker` when 2 consecutive auto-resumes leave `next_action` unchanged or 3 auto-resumes per invocation. Counters persist in the turn decision, so a replay repeats them; `unchanged` increments only when `pre` (the `next_action` before the auto-resume) equals the new one.
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:242-245,303-314; wildera:.agents/skills/gsd-debug/SKILL.md:51
- Why it exists: upstream no-progress heuristic; compatibility.md:75.
- Test idea: fake debugger returns CONTINUE_REQUIRED with a constant `next_action` -> after 2 resumes `needs-owner` `blocker`.

### GDB-44 `finish`: result shape and lease release
- Behavior: `finish(status, reason, extra, keepLease)` ends the invocation (`--outcome <status>`), releases the lease unless `keepLease`, reads `debug status`, logs, and returns `{status, reason, slug, session, sessionStatus, budget, turns, ...extra}`. A lease is kept only when a deadline stop finds `stillAlive` workers (`leaseKept` in the result).
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:57-70
- Why it exists: ownership goes only after every worker is gone (comment :65).
- Test idea: every terminal path leaves no lock file except the `stillAlive` case.

### GDB-45 Debugger agent definition is generated from upstream
- Behavior: `.agents/agents/gsd-debugger.md` is generated by `port.mjs build` from the vendored upstream `agents/gsd-debugger.md`: new front matter (`name`, `description`, `model: pro` as fallback only ("the GSD workflows pass the model from their args"), `tools: [Read, Write, Edit, Bash, Grep, Glob, WebSearch]` (upstream Skill dropped), `include:` shared adapter.md + gsd-debug adapter.md), a GENERATED comment, a `<wildera_adapter_precedence>` block ("adapter wins; method unchanged"), then the upstream body with ONLY path rewrites (`~/.claude/gsd-core/`, `@gsd-core/`, bare `gsd-core/(references|templates|workflows|contexts)/` -> the vendored snapshot dir). Do-not-edit rule: change the adapter or port.mjs and rebuild.
- Proposal: CHANGE: the new kit ships the GSD core and the generic agents, so the debugger is a shipped file with the adapter as an overlay; keep the "upstream text unchanged, adapter wins" layering and a check that detects hand edits. Model by role comes from the project adapter.
- Source: wildera:tools/gsd/port.mjs:43-45,122-128,130-142,64-69; wildera:.agents/agents/gsd-debugger.md:1-17
- Why it exists: "Keep GSD's ideas intact; change only the adapter" (wildera:_workspace/gsd-port/DESIGN.md:10-12).
- Test idea: modify the generated agent by hand -> `check` reports it stale; rebuild restores it.

### GDB-46 Debugger adapter rules (session, returns, data)
- Behavior: the debugger is spawned by the workflow with the upstream Step 2/3d prompt plus `<runtime_adapter>`; the session file is its brain (update BEFORE acting, Current Focus overwritten, Evidence/Eliminated append-only, Symptoms immutable, concrete `next_action`); only the workflow writes `## Checkpoints`, `## Acceptance`, moves to `resolved/` and appends the KB (the debugger gives a Prevention block instead); Phase 0 KB = keyword overlap on `.planning/debug/knowledge-base.md` (MemPalace not installed); specialist hint `general`; `tdd_mode` off; `symptoms_prefilled: true`. It never asks a question or waits: a checkpoint/request ends the turn. Phase 1.25 SBFL skipped with a logged note (no per-test coverage); "run it 100 times" becomes a few runs at the conditions that differ (frame-rate edges). Never commit, stage or stash.
- Proposal: KEEP rules; dropped upstream features (MemPalace, specialist skills, TDD) stay dropped (OPEN: TDD, see questions).
- Source: wildera:.agents/skills/gsd-debug/references/adapter.md:5-14,20,32,45
- Why it exists: unattended workers; harness rule "no commits by agents" (compatibility.md:87,89).
- Test idea: the debugger's turn leaves the session file valid; no git index/commit changes.

### GDB-47 Debugger must request engine runs (EXPERIMENT REQUEST contract)
- Behavior: the debugger never runs `tools/ue/Build.ps1`, `Test.ps1`, `Scenario.ps1`, `Smoke.ps1`, `RunEditorPython.ps1`, UBT, RunUAT or the editor; it returns `EXPERIMENT REQUEST` with `experiment.kind` + allowed fields, `hypothesis` (the one it tests) and `expected` (what confirms/refutes), after writing Current Focus (`hypothesis,test,expecting,next_action`); one experiment per turn; results come next turn between DATA_START/DATA_END and must be appended to Evidence. Budget in the runtime block is real; runs reserved for acceptance are not the debugger's; prefer existing evidence (verify and scenario run dirs) over a new run. Results are judged as the Verify stage judges them (fresh validated scenario with the frame-rate cap evidenced; test only with a complete fresh automation log).
- Proposal: CHANGE: mechanism KEEP; the engine tools named belong to the project adapter (a generic list of "project-defined heavy commands the debugger must request").
- Source: wildera:.agents/skills/gsd-debug/references/adapter.md:22-32
- Why it exists: only the orchestrator or a Verify-like stage builds (compatibility.md:83).
- Test idea: a fake debugger run during which `Saved/Logs/*.log` appears -> audit stops the session (GDB-29).

### GDB-48 Fixing rules for the debugger (generic vs WildEra)
- Behavior: edit only inside `edit_scope`; never a shared file; temporary instrumentation is part of the delta and must be removed before acceptance; follow `game/CODING.md` and `game/LAYOUT.md` (an edit hook checks every `.h/.cpp`). Root-cause rule: repair the demonstrated cause without weakening the contract; a fixture/scenario/config correction is allowed only when a named spec line, an owner decision or a demonstrated mismatch with the production lifecycle supports it, and that support is named in Resolution.fix; never weaken an assertion, enlarge a tolerance, lengthen a wait or re-press inputs to get a pass; keep independent behavioural evidence; for failures only at some frame rates machine health (frame-health gate, `nvidia-smi` clocks/pstate) confirms or eliminates an environment hypothesis, remaining candidates are tested not presumed; upstream competing categories and AND-gate apply. Guardrail mapping: signals 1, 4, 5 are the workflow's (record `pending: workflow acceptance`); signal 2 mutation `skipped, reason: no mutation tool configured`; signal 3 no-op/deletion assessed by the debugger on its diff. On completion the debugger returns `CHECKPOINT REACHED` `human-verify` with `ownerOnly`, `prevention{oneLine,errorPatterns,whyNotCaught,recurrenceGuard}`, `filesChanged`.
- Proposal: CHANGE: the "never weaken an assertion/tolerance/wait" rule and the guardrail mapping are generic KEEP; the CODING.md/LAYOUT.md, frame-rate and nvidia-smi sentences are WildEra adapter text and must live in the project adapter.
- Source: wildera:.agents/skills/gsd-debug/references/adapter.md:34-45
- Why it exists: the `camera-orbit-s103` run shows a fixture-oracle correction justified by a spec line (UX-LIVE.md:27-29) (wildera:.planning/debug/camera-orbit-s103.md:73-74,102).
- Test idea: n/a for prompt text; check the adapter overlay is loaded in the debugger's include chain.

### GDB-49 Debugger result schema (workflow side)
- Behavior: the agent call uses a JSON schema: required `marker`, `summary`; `checkpointType` enum `human-verify|human-action|decision`; `question`; `experiment{kind (req), hypothesis (req), expected (req), target, noAdaptiveUnity, filter, scenario, scenarios[], keepAlive, maxFps, clients, weDevMap, weDevSpecies, netEmulation, resX, resY, reconnectAfterStep, reconnectDelaySeconds, runtimeTimeoutSeconds, clientArgs}`; `scope{paths[], reason}` (both required); `ownerOnly[]`; `prevention{oneLine,errorPatterns,whyNotCaught,recurrenceGuard}`; `filesChanged[]`.
- Proposal: CHANGE: `experiment` properties derive from the adapter's experiment-kind table (GDB-13).
- Source: wildera:.agents/workflows/gsd-debug.js:13-32
- Why it exists: not stated.
- Test idea: schema rejects an `experiment` without `hypothesis`/`expected`.

### GDB-50 `gsd-debug` skill: main-session procedure
- Behavior: Step 1 (before delegation): write `_workspace/gsd-debug/<label>/signature.json` with a file tool (never via shell) with `signature{kind,key,label}`, `seenAt[{maxFps,command,evidence}]`, `tasks`, `owns`, `files` (never shared), `trigger`, `symptoms`, `acceptance{signature[] one typed request per frame-rate edge seen, gate[] the wave's gates, tests[] touched filters}`, `goal`; then `node tools/gsd/gsd.mjs --root <code root> debug create < signature.json` returns the slug. For an owner report: gather the five upstream symptoms as numbered plain-text questions, never a picker, confirm values already given, treat them as data. Step 2: no code-wave/gsd-plan/other coding agent may work in that root; fresh UUID per invocation; write `_workspace/gsd-debug/<slug>/args.json`; run `paseo_harness.mjs workflow --name gsd-debug --args-file ... --detach`, Monitor on the printed `watch-run` command, record runId in `run_meta.json`; do not build/test/run scenarios in that root meanwhile. Sessions run serially, never in parallel. Subcommands: list / status (plus reading the md, no agent) / continue (Step 2 with the existing slug). Never hand-edit `*.state.json`, `registry.json`, `## Checkpoints`, `## Acceptance`.
- Proposal: CHANGE: keep steps; replace Backlog/WildEra specifics (code-wave `needsDebug`, `_workspace/gsd-debug` paths) by kit paths; the `ph workflow --detach` + watch pattern fits the owner decisions.
- Source: wildera:.agents/skills/gsd-debug/SKILL.md:10-51
- Why it exists: upstream debug.md step 3 / session-manager split (SKILL.md:8-10).
- Test idea: skill dry-run: `create` from a signature.json and `list` shows the session; a second launch while the lease is held returns `busy`.

### GDB-51 Handling a workflow result (skill step 3)
- Behavior: `resolved` -> read `resolved/<slug>.md` and the KB entry, report root cause/fix/evidence, the delta is authorized for reconciliation, continue code-wave Step 3, commit only when the owner asks. `diagnosed` -> never a fix authorization; route to a gap plan or the owner. `needs-owner` -> present checkpoint (id, type, question, options) in plain text with a recommendation; the next invocation (new UUID) carries `checkpointAnswer {id, response}`; `acceptDebt:true` only for an owner-accepted guardrail failure; `scope`: after agreement `debug grant --slug --paths a,b` then answer; `budget-exhausted|deadline|turn-cap` also need `budgetExtension {runs, minutes, reason}`; `human-verify`: `confirmed:true` (+ optional `prevention`) closes without new runs. `busy`: wait; stale lease -> `debug lock status` -> inspect session and `paseo ls` -> `debug lock clear --slug <holder>`; never clear a live lease. `failed`: read the run's `journal.jsonl`/`log.txt` and the session file; do not retry quota/auth/permission failures. `--resume <runId>` with the same args and invocationId only after an interrupted run.
- Proposal: KEEP.
- Source: wildera:.agents/skills/gsd-debug/SKILL.md:53-61
- Why it exists: not stated beyond design (GDB-31..35).
- Test idea: scripted run to each status and assert the documented next command works.

### GDB-52 Forensics skill and generated workflow
- Behavior: `gsd-forensics` is a main-session, read-only investigation: no agent, workflow, build, test, scenario or editor run; the only file written is the report. It runs the generated upstream `forensics.md` (path rewrites only) with WildEra adaptation: Step 1 ask the problem in plain text if absent; Step 2 evidence adds the code root (`git -C <worktree> status/log`), `.planning/debug/` (sessions, registry, KB, state budgets, checkpoints, request records), workflow runs `_workspace/_runs/<runId>/{run.json,journal.jsonl,log.txt,result.json,args.json}` and `_workspace/gsd/<phase>/run_meta.json`, code-wave evidence (Verify rounds `_workspace/verify/<waveId>/run-<n>/verify.json`, result `needsDebug`/`debugSignatures`, scenario run dirs, review gate fields); not used: `.planning/config.json`, `SESSION_REPORT.md`. Step 3 keeps every upstream anomaly pattern (stuck loop, missing artifact, partial-plan drift, abandoned work, crash/interruption, scope drift, test regression) and adds: same failure signature repeating across Verify rounds/fix waves without a persistent hypothesis record; a debugger without a session file or log = unbounded loop; record `debug lock status` when involved. Step 4 writes `.planning/forensics/<YYYY-MM-DD>-<slug>.md` in the planning checkout (upstream template + redaction rules: relative paths, strip credentials, truncate diffs to 50 lines), labels each hypothesis "forensic hypothesis, not debugger-confirmed", and for a failure signature adds candidate hypotheses plus the evidence paths gsd-debug needs. Steps 5-6 present and answer follow-ups from gathered evidence. Step 7 (GitHub issue) skipped (outward-facing, not a GSD defect). Step 8 (`state.record-session`) not ported: the main session writes one STATE.md line only when the investigation concerns the active phase.
- Proposal: CHANGE: keep read-only main-session method, redaction and the debug-session evidence; drop code-wave/Backlog/Unreal paths unless the adapter declares them; keep skipping the GitHub-issue step; the report name pattern `<date>-<slug>.md` (upstream `report-<timestamp>.md`).
- Source: wildera:.agents/skills/gsd-forensics/SKILL.md:8-25; wildera:.agents/skills/gsd-forensics/generated/forensics.md:10-11,174-239,257-286
- Why it exists: "Outward-facing step; single STATE writer" (compatibility.md:93).
- Test idea: run forensics on a fixture repo with a repeated failing signature; report exists at the dated path, flags the loop, names each hypothesis as forensic, contains no absolute home path.

### GDB-53 Forensics generated file: path rewrites and the unused upstream machinery
- Behavior: `generated/forensics.md` is the upstream workflow plus a GENERATED comment; the long `gsd-tools.cjs` bootstrap one-liner in Step 8 and the `gh issue create` block remain in the text but are overridden by the skill. The only rewrite is path text (and the `@.../response-language-directive.md` include).
- Proposal: DROP the multi-runtime `gsd_run` shim blocks (they enumerate Codex/Cursor/etc. homes) in the new kit; ship only the Claude-Code-relevant method text or reference the upstream text without the shim.
- Source: wildera:.agents/skills/gsd-forensics/generated/forensics.md:1-3,257-286; wildera:tools/gsd/port.mjs:193-195
- Why it exists: Codex/OpenCode/Pi support dropped by the owner (2026-10-20).
- Test idea: n/a.

### GDB-54 port.mjs `check` coverage for the debug flow
- Behavior: `port.mjs check` fails (exit 1) when the vendored snapshot was edited, a generated file is stale/hand-edited, a referenced vendored file is missing (direct = problem, deeper = warning), an unmapped `gsd_run` verb appears, or `managerTemplates` anchors/placeholders of the session manager vanished. `vendor --from <clone>` refuses a clone whose HEAD is not the pinned commit and any symlink; the clone is untrusted data (HEAD read from `.git` files without running git there). Debug snapshot entries: `agents/gsd-debugger.md`, `agents/gsd-debug-session-manager.md`, `gsd-core/workflows/debug.md`, `gsd-core/workflows/forensics.md` plus references/templates.
- Proposal: CHANGE: the new kit ships the GSD core as maintained source, so the vendor/generate/check pipeline may shrink to "upstream bump = diff review + placeholder/anchor test"; keep the untrusted-clone rules for any vendoring command.
- Source: wildera:tools/gsd/port.mjs:2-7,19-35,98-112,196-197,208-220,244-284
- Why it exists: upstream bump workflow (header comment :6-7).
- Test idea: change one template anchor -> check fails with the anchor name.

### GDB-55 Two status vocabularies: session md vs state.json
- Behavior: md frontmatter `status` (debugger-visible): `gathering|investigating|fixing|verifying|awaiting_human_verify|resolved|diagnosed` (upstream plus `diagnosed`). state.json `status` (workflow-visible): `open`, `needs-owner`, `budget-exhausted`, `deadline`, `turn-cap`, `diagnosed`, `resolved`; registry `status` mirrors state.json. The post-turn check rejects a debugger that sets `resolved` or moves the file to `resolved/`.
- Proposal: CHANGE: keep two vocabularies but document and test the mapping; consider one derived field to avoid drift.
- Source: wildera:tools/gsd/debug.mjs:25,570,673,724,863,880; wildera:.agents/workflows/gsd-debug.js:234; wildera:.planning/debug/registry.json:6-8
- Why it exists: the debugger owns md progress, the workflow owns lifecycle.
- Test idea: after a `deadline` checkpoint the registry shows `deadline` while the md still says its debugger status.

### GDB-56 CLI contract of `gsd.mjs ... debug`: output, exit codes, errors
- Behavior: each command returns `{code, out}`; `out` is printed as JSON on the LAST stdout line (the workflow parses only the last line) and `code` is the exit code: 0 ok, 1 invalid/refused/blocked, 66 missing session/request/snapshot/revert (`fail(msg, 66)`), `fail()` throws an Error with `.code` (default 1), the workflow reads `json.error`/`json.refused`/`json.reason`, the dispatcher prints a thrown error as one JSON line `{status:'error', error: message}` and sets the exit code to `e.code` when it is an integer, else 1 (wildera:tools/gsd/gsd.mjs:1066-1068, read in r1); see GDB-67. Stdin is a JSON object (empty = `{}`). The dispatcher (`gsd.mjs`) passes `ROOT` (canonical code root from `--root`), `SCRIPT`, `HARNESS`, `frontmatter`, `ownedPrefixes`, `isShared` in `ctx`.
- Proposal: KEEP the contract (JSON last line + exit codes); the dispatcher belongs to another area.
- Source: wildera:tools/gsd/debug.mjs:40-44,34,124,241,777; wildera:.agents/workflows/gsd-debug.js:44-50
- Why it exists: workflow scripts only have `shell()`, so the CLI is the API (wildera:_workspace/gsd-port/DESIGN.md:178-180).
- Test idea: run any failing command and check the last stdout line parses as JSON with `error` and the exit code is non-zero.

### GDB-57 Frame-rate edges as acceptance coverage (WildEra-specific concept)
- Behavior: a flaky scenario signature is accepted only if it is green at EVERY `maxFps` it was seen at (`seenAt[{maxFps,command,evidence}]` -> one `signature` plan item per edge), plus the wave's gate scenarios and the touched capabilities' tests. New observations at a new edge widen the plan and invalidate an earlier passed acceptance.
- Proposal: CHANGE: generalise to "every condition variant the signature was observed under" (seenAt carries opaque variant params that the adapter maps to request fields).
- Source: wildera:tools/gsd/debug.mjs:558,575-579,536-544; wildera:.agents/skills/gsd-debug/SKILL.md:27,55
- Why it exists: a failure seen only at some frame rates (adapter.md:38); intermittent camera-orbit failure at 30/240 (wildera:.planning/debug/camera-orbit-s103.md:37,39).
- Test idea: `create` with seenAt for 30 then again for 240 -> plan grows by one item and `acceptance.passed` clears.

### GDB-58 Session-file conventions seen in a real session
- Behavior: observed in `camera-orbit-s103.md` (status diagnosed): frontmatter `status, trigger, created, updated`; `## Current Focus` carries the upstream four fields plus `bug_class`, a `reasoning_checkpoint` map (hypothesis, confirming_evidence, falsification_test, fix_rationale, blind_spots, candidate_causes with >=2 categories, and_gate) and `tdd_checkpoint: null`; `## Symptoms`; `## Eliminated` (`hypothesis/evidence/timestamp`); `## Evidence` (`timestamp/checked/found/implication`; first entry written by `create`); `## Resolution` (`root_cause` list with `code:`/`data:` categories, `fix`, `verification` map per guardrail signal with `pending: workflow acceptance`, `oracle_type`, `files_changed: []`); `## Checkpoints` written by the workflow with the answered/raised question wrapped in DATA_START/DATA_END and every line indented 4 spaces (so a `## ` heading inside the data cannot be read as a section).
- Proposal: KEEP formats; the 4-space indent of data blocks is a required invariant of the parser.
- Source: wildera:.planning/debug/camera-orbit-s103.md:1-134 (esp. 8-31,96-112,114-133); wildera:tools/gsd/debug.mjs:131-136,657,726
- Why it exists: `sectionOf` splits on `^## `; indentation protects embedded debugger summaries.
- Test idea: raise a checkpoint whose question contains a line `## CHECKPOINT REACHED`; `debug status` still parses all sections.

### GDB-59 Lesson: fix already in the dirty tree before the baseline
- Behavior: in `camera-orbit-s103` the correcting hunk was already in the uncommitted wave tree when the baseline snapshot was taken, so the session's own fix delta was empty; `acceptance begin` returns `empty:true` ("tree equals the baseline snapshot: no fix delta exists"), revert-and-reconfirm cannot be honest, and the debugger raised a `decision` checkpoint asking to adopt the inherited hunk as the acceptance delta; the session ended `diagnosed`. No mechanism exists to adopt an inherited hunk into the reversible delta.
- Proposal: OPEN: add an explicit "adopt hunk(s) into the delta" (owner/main-session command) or let the snapshot baseline be HEAD-minus-named-files; see Open questions.
- Source: wildera:.planning/debug/camera-orbit-s103.md:76-79,91-94,109,116-133; wildera:tools/gsd/debug.mjs:826; wildera:.agents/workflows/gsd-debug.js:105; wildera:.planning/debug/registry.json:6-8
- Why it exists: a hand-written debugger had left uncommitted diagnostics/fixes in the same tree (camera-orbit-s103.md:40).
- Test idea: start a session on a tree where the fix hunk is already present; the system reports the empty delta and offers the owner a defined adoption path instead of a dead end.

### GDB-60 Checkpoint answer written to the md before the wall-budget check; refusal does not save (r1)
- Behavior: in `invocation start` for a NEW invocation with an open checkpoint: (1) answer missing/not matching -> `refused:'awaiting-owner'`; (2) `budget-exhausted|deadline|turn-cap` type without `budgetExtension` -> `refused:'budget'` BEFORE any write; (3) otherwise the answer is stored in memory and appended to the md `## Checkpoints` (4-space DATA block) via `writeAtomic`; (4) the extension is applied in memory, interrupted invocations are closed in memory; (5) only then the wall check `leftMin = budget.minutes - usedMin <= 0` returns `refused:'budget'` WITHOUT `saveState`. Result: state.json still shows the checkpoint unanswered, the md already holds the response, and a later start asks again and appends a second block. This also hits a `human-verify` answer (no extension required) when the wall is already spent: the "confirmed, no new runs" close (GDB-42) is unreachable until the wall is extended, and the confirmation is not stored.
- Proposal: CHANGE: make the refusal atomic (check wall budget before writing the md, or save the answer in state before refusing); a `human-verify` confirmation must not need wall budget.
- Source: wildera:tools/gsd/debug.mjs:649-669,677
- Why it exists: not stated (ordering side effect).
- Test idea: spend the wall budget, answer a `human-verify` checkpoint with `confirmed:true` and no extension: expect the answer persisted exactly once and a defined outcome, not a duplicate md block on retry.

### GDB-61 Two different per-run clocks (r1)
- Behavior: `args.perRunMinutes` (default 30) only sets the workflow's `shell()` wait for `debug run`: `perRunMinutes * 60 + 900` seconds (gsd-debug.js:42,73). The workflow never passes `--capMinutes`. The process-tree kill deadline is `min(now + cap, invocation deadline)` with `cap = --capMinutes ?? state.limits.perRunMinutes`, and `limits.perRunMinutes` is fixed at `debug create` (`inp.perRunMinutes` or 30), not taken from workflow args (debug.mjs:773-775,612). Every other `gsd.mjs` call from the workflow uses the default `shell()` timeout of 600 s (gsd-debug.js:44).
- Proposal: CHANGE: one config key for the per-run cap, read by both the runner and the orchestrator's wait (wait = cap + margin); never two independent knobs.
- Source: wildera:.agents/workflows/gsd-debug.js:42-45,73; wildera:tools/gsd/debug.mjs:612,773-775
- Why it exists: not stated.
- Test idea: create a session with `perRunMinutes` 5 and launch the workflow with `perRunMinutes` 60: the engine is killed at 5 min.

### GDB-62 Checkpoint-continuation prompt hardcodes `goal: find_and_fix` (r1)
- Behavior: `renderPrompt` fills `{goal}` and `{symptoms_prefilled}` only in the Step 2 block. The first ```markdown block after `### 3d. CHECKPOINT REACHED` (the one `managerTemplates` loads) contains `<mode> goal: find_and_fix` literally and has no symptoms placeholder; its `{if tdd_mode}`/`{if tdd_phase}` lines are stripped (both false). A `find_root_cause_only` session resumed after an owner checkpoint is therefore told `goal: find_and_fix` in `<mode>` while the appended `<runtime_adapter>` may say `product-read-only`; the debugger sees contradictory instructions.
- Proposal: CHANGE: render `goal` explicitly in every turn kind and make the product-read-only line unmistakably authoritative (or patch the continuation template in the kit's own copy).
- Source: wildera:.agents/skills/gsd-plan/upstream/agents/gsd-debug-session-manager.md:89-93,250-278 (outside scope, read in r1); wildera:tools/gsd/debug.mjs:957-962,969-978
- Why it exists: upstream template text; the port fills only what the template has placeholders for.
- Test idea: render a `checkpoint` turn for a `find_root_cause_only` session and assert the prompt states a single, non-contradictory goal.

### GDB-63 Resumed invocation semantics (r1)
- Behavior: `invocation start` for an id already recorded returns early (`resumed:true`, with the current `status`, `goal`, `budget`, and the `answered` checkpoint of that invocation) after reopening a closed time segment when the last one ended; it does NOT clear `binaries`, does NOT set `status:'open'`, does NOT re-apply `goal`/`budgetExtension`, and does not re-run the checkpoint/budget checks. Only a new UUID goes through the full path (including `binaries = {}` and the status reset).
- Proposal: KEEP; the workflow's replay depends on it.
- Source: wildera:tools/gsd/debug.mjs:637-642,674-676
- Why it exists: replay-safe resume (compatibility.md:100).
- Test idea: start, run a build, resume with the same UUID: `binaries` still holds the build; start with a new UUID: `binaries` is empty and the next test request returns `needsBuild`.

### GDB-64 Unverifiable Paseo listing keeps the lease in `supervise` (r1)
- Behavior: in `supervise`, `stopEngines` pushes the string `paseo agents unverified` into the `alive` list when `paseo ls --json` (or `paseo archive`) throws. That entry counts as a living worker: with a dead runner the supervisor returns `{runnerDead:true, kept:'workers still alive; the lease stays for the main session'}` without finalizing or releasing the lease; at the deadline the grace path calls `finalize` only when `stopEngines().alive` is empty, so the lease also stays. Agents archived are those running with name matching `^gsd-debug:` and containing the slug.
- Proposal: KEEP fail-closed behavior; CHANGE the agent matching to the kit's agent registry (see Concerns on the name mismatch).
- Source: wildera:tools/gsd/debug.mjs:891-900,916-919,927-929
- Why it exists: ownership is released only after every worker is gone (comment :890).
- Test idea: make `paseo ls` fail at the deadline: `deadline.json` lists `stillAlive` with the unverified marker and the lock file remains.

### GDB-65 `turn begin` refusals and decision replay in the loop (r1)
- Behavior: when `turn begin` exits non-zero: `refused:'deadline'` -> `deadlineStop`; `refused:'turn-cap'` -> `needs-owner` with a checkpoint key `<inv>:turn-cap`, type `turn-cap`, question about the invocation's hard cap ("extend (budgetExtension) or stop"); any other failure -> `failed` (`cannot begin turn k`). A turn whose stored decision exists replays `({c,next} = decision); continue` immediately after `turn begin`, i.e. without the deadline check, audit, delta check or status validation for that turn (they were done when the turn first ran).
- Proposal: KEEP.
- Source: wildera:.agents/workflows/gsd-debug.js:200-208
- Why it exists: replay-safe turns (GDB-21).
- Test idea: set `maxTurns` 1: the second turn begin ends `needs-owner` type `turn-cap`; resume with the first turn's decision stored: no agent spawn and no audit on replay.

### GDB-66 `authorizedDelta` is a union that survives reopen (r1)
- Behavior: `authorizedDelta` in state.json is extended only by `close --outcome resolved` with `inp.delta` (the accepted attempt's path list). On reopen (`create` for a resolved signature) state drops `acceptance.current/passed` and appends `reopened`, but keeps `authorizedDelta` and `resolution`. `reconcile check` reads `authorizedDelta` from EVERY `*.state.json` under `.planning/debug/`, so paths of a reopened (open again) session stay authorized until it is closed again.
- Proposal: CHANGE: scope authorization to the session's current lifecycle (clear or version it on reopen) so an open session does not authorize paths for reconciliation.
- Source: wildera:tools/gsd/debug.mjs:563-570,879,82-84
- Why it exists: not stated.
- Test idea: resolve a session, reopen it, change one of its delta paths: `reconcile check` must report it (after the change) unless the new lifecycle authorizes it.

### GDB-67 Dispatcher envelope, `--root` check, `init.debug` (r1)
- Behavior: `gsd.mjs` prints `out` as one JSON line (or `--pick <key>` value) and sets `process.exitCode = code`; a thrown error prints `{status:'error', error}` with `e.code` if it is an integer, else 1. `--root` must be a git checkout or worktree root (`.git` exists) or it throws before `debugMain` with code 69. `tree`, `reconcile` and `debug` dispatch to `debugMain` with `ctx {ROOT, HARNESS, SCRIPT, frontmatter, ownedPrefixes, isShared}`. `query init.debug` (called from the vendored `debug.md` step 0, not by `gsd-debug.js`) returns `{debug_dir, project_root, commit_docs:false, tdd_mode:false, debugger_model:'circle/gpt-6.1-sol[1m]', section_manifest:null, note}`.
- Proposal: KEEP the envelope and exit codes (69 = unavailable/not a checkout, 66 = missing); `init.debug` model comes from adapter config.
- Source: wildera:tools/gsd/gsd.mjs:871-873,945-953,1060-1070 (outside scope, read in r1)
- Why it exists: DESIGN.md says exit codes 0 valid, 1 invalid, 66 no input, 69 unavailable (wildera:_workspace/gsd-port/DESIGN.md:95-98).
- Test idea: `--root` pointing at a non-git dir exits 69 with the error JSON.

### GDB-68 Lock record fields and edge behaviors (r1)
- Behavior: the lock file holds `token, slug, codeRoot (resolved), invocation, runnerPid (grandparent via CIM; null if the query fails), phase ('pending' then 'active'), acquiredAt, leaseUntil`, plus `renewedAt` after renewals and `supervisorPid` once a supervisor runs. `renew --supervisor <pid>` can set `supervisorPid`; `debug supervisor` writes it itself. `lock clear` with no lock returns exit 0 `{cleared:false, reason:'no lock'}`; `lock check` returns exit 1 only when a lock exists for this root.
- Proposal: KEEP the fields (lease holder, liveness inputs).
- Source: wildera:tools/gsd/debug.mjs:349-352,383-385,411,419,421-423,941
- Why it exists: stale detection needs runner pid, lease end and supervisor pid (GDB-33).
- Test idea: `acquire` then read the lock file: all fields present; `clear` without a lock exits 0.

## Invariants and lessons

- Identity is a tree digest over evaluated inputs; evidence and control dirs are outside it so recording evidence never changes the identity (debug.mjs:20-23). Every acceptance/run record carries the digest it is bound to (compatibility.md:103).
- A run is never launched twice and never lost: the request is durable as `running` with its deadline before the process starts; a detached wrapper owns the process tree; resume picks up the result or marks the request `uncertain` (debug.mjs:434-437,524-533).
- Revert/reapply are transactions: backup + record durable before any file changes; targets recorded up front; an intervening edit stops with both versions kept; backups are never deleted in recovery (debug.mjs:266-331).
- Revert only the fix delta, never `git stash`, never a tree someone else changed (adapter.md:39; compatibility.md:86).
- A signal that cannot run is skipped with a reason, never passed; revert-and-reconfirm needs the signature ITSELF to return (same step/test/build file); "another failure does not count" (adapter.md:44; debug.mjs:444-469).
- An owner answer never refills a budget; a budget extension needs runs, minutes and a reason (debug.mjs:654; SKILL.md:57).
- The debugger never runs engines; engine artifacts inside its turn window stop the session (debug.mjs:790-801).
- Experiments stay inside budget; the acceptance reserve is not spendable by experiments; builds cost time, not runs (debug.mjs:338-343,750-753).
- Lease is released on every exit; ownership transfers only after every worker is gone (gsd-debug.js:65,317).
- Same signature -> same session; resolved + reappears -> reopen with the earlier resolution as evidence (debug.mjs:559-570).
- Only the workflow writes `## Checkpoints`, `## Acceptance`, `resolved/` and the KB; Symptoms immutable; Evidence/Eliminated append-only (adapter.md:8-9).
- Everything interpolated into a shell is validated (slug regex, UUID, drive path); argv is never built by string concatenation from agent text (gsd-debug.js:36; debug.mjs:173).
- Restored files get a bumped mtime so git's second-resolution stat cache cannot hide a same-size rewrite (debug.mjs:253-265).
- Untrusted text (owner answers, logs, results) is DATA_START/DATA_END and indented in the session file (debug.mjs:657,726).
- Diagnose-only (`find_root_cause_only`) is product-read-only; `diagnosed` is never a fix authorization (gsd-debug.js:225-228,265).
- Debug sessions run serially; no coding agent or workflow may write in that code root while one runs (SKILL.md:20,38).
- Never commit, stage or stash from the debug flow (adapter.md:45).
- Forensics is read-only; the only file is the report; every hypothesis is labelled "forensic hypothesis, not debugger-confirmed" (forensics SKILL.md:10,22).

## Interfaces

CLI (`node tools/gsd/gsd.mjs --root <code root> ...`, JSON on stdin, JSON last stdout line):
- `tree digest|changed`; `reconcile baseline --out F | check --args F --baseline F [--authorized a,b]`.
- `debug create` (stdin signature.json) | `list` | `status --slug` | `state --slug`.
- `debug invocation start|end --slug --id <uuid> --token T [--outcome X]`; `debug turn begin|end|decide --slug --inv --index`.
- `debug checkpoint --slug` (stdin type/question/options/key/invocation); `debug grant --slug --paths a,b`.
- `debug request --slug --id`; `debug run --slug --id [--capMinutes]`; `debug exec --slug --id` (internal wrapper); `debug audit --slug --since --until`.
- `debug snapshot --slug [--new]`; `debug delta`; `debug revert --id`; `debug reapply --id`; `debug recover`.
- `debug acceptance begin|step|end --slug`; `debug close --slug --outcome resolved|diagnosed`.
- `debug lock acquire --slug --invocation | check | status | renew --token | release --token | clear --slug <holder>`; `debug supervisor --slug --token` (starts) / `debug supervise` (internal) / `debug deadline`.
- Not listed in the usage error string: `exec`, `supervise`, `recover` (debug.mjs:949).

Workflow `gsd-debug` (`paseo_harness.mjs workflow --name gsd-debug --args-file ... --detach [--resume runId]`): args in GDB-36; result `{status: resolved|diagnosed|needs-owner|busy|failed, reason, slug, session, sessionStatus, budget, turns, checkpoint?, acceptance?, debugger?}`; phases Debug, Experiment, Acceptance.

Files: `.planning/debug/{<slug>.md, <slug>.state.json, registry.json, knowledge-base.md, resolved/<slug>.md, <slug>/{runs,turns,deadline.json}}`; `_workspace/gsd-debug/<label|slug>/{signature.json,args.json,run_meta.json}`; machine data `%LOCALAPPDATA%/WildEra/gsd-debug.lock` and `%LOCALAPPDATA%/WildEra/gsd-debug/<sha12(root)>/<slug>/snap-N/{files/,staged.patch,meta.json,revert-<id>-<ts>/}`; `.planning/forensics/<YYYY-MM-DD>-<slug>.md`.

state.json keys: `version, slug, signatureId, signature, codeRoot, goal, status, revision, createdAt, updatedAt, symptomsSha, adapter, budget{runs,minutes,extensions[]}, limits{maxTurns,perRunMinutes}, scope{owns,files,grants}, seenAt, tasks, acceptance{plan,revertRuns,attempts,current,passed,seq}, invocations[], turns{}, requests{}, builds, binaries{}, snapshots[], reverts{}, checkpoints[], authorizedDelta[], reopened[], resolvedAt, resolution`.

Config (hardcoded; all should become adapter/config keys): DEFAULTS runs 12, minutes 120, maxTurns 16, perRunMinutes 30 (debug.mjs:24); lease 45 min (:397,:419); supervisor grace 10 min, poll <= 20 s (:922,:927); awaitResult grace 120 s, poll 2 s (:525-526); writers' run.json recency 7 days (:357); MANIFEST (:22-23); adapter version `wildera-gsd-debug/1` (:19); per-run cap min 0.1 min (:773); auto-resume 2 unchanged / 3 per invocation (gsd-debug.js:305); debugger model default `circle/gpt-6.1-sol[1m]`, effort `high` (gsd-debug.js:41).

## Cross-area dependencies

- gsd-plan / gsd-upstream: `gsd.mjs` dispatcher (`ctx.ROOT/SCRIPT/HARNESS/frontmatter/ownedPrefixes/isShared`), the vendored upstream snapshot (`templates/DEBUG.md`, `agents/gsd-debug-session-manager.md`, `gsd-debugger.md`, `forensics.md`, references `debugger-*.md`), `port.mjs` generation + `check`, the shared GSD adapter (`gsd-plan/references/adapter.md`: Running unattended, Project context and paths, gsd_run, Commits and state apply to the debugger), NOTICE/licence.
- workflow: runs under `ph`/Paseo workflow runner (`agent()`, `shell()`, `phase()`, `log()`, `args`, `--detach`, `--resume`, `watch-run`); session `debugger:<slug>` persistence; run dirs `_workspace/_runs/<runId>/{run.json,journal.jsonl,log.txt,result.json,args.json}` (read by `writers()` and forensics); agent names/status from `paseo ls --json`, archive via `paseo archive`.
- files / hooks: the debugger's edit hook (checks `.h/.cpp` it touches; project hook), harness-files MOD for batched reads; shared-file definition (`ctx.isShared`).
- history / execute (code-wave): `needsDebug` signatures and `debugSignatures` produced by code-wave Verify feed `debug create`; code-wave and gsd-plan admission refuse to start while `debug lock check` is locked for that root; `authorizedDelta` of closed sessions feeds `reconcile check`; Verify validators `tools/ue/verify.mjs` (`scenarioRequest`, `validateScenario`, `parseAutomation`) and `tools/ue/{Build,Test,Scenario}.ps1` are required by `exec`.
- method: debugging method text (scientific method, reasoning checkpoint, guardrail) is upstream; owner rule that Paseo/`ph` orchestrates (main provider denies Agent/Workflow), so skill steps use `ph workflow`.
- install: ships `tools/gsd/debug.mjs`, the workflow, skills, agent, `references/adapter.md`; machine dirs (`%LOCALAPPDATA%` lease/snapshots) are runtime, not installed.
- ui: none (checkpoints are presented as plain-text questions by the main session).
- gsd-debug -> forensics: forensics reads `.planning/debug/**` and hands a candidate signature + evidence paths to `debug create`.

## Concerns

- `debug.mjs` is one 997-line closure of ~25 subcommands with dense one-line style; state machine invariants live implicitly in code. Split by concern in the rewrite (tree, session, runs, delta, lock, accept) with unit tests; the old file has no tests in scope (debug.mjs:40-981).
- Windows-only: `powershell.exe -File`, `taskkill /T /F`, `Get-CimInstance` for the runner pid, `%LOCALAPPDATA%`, case-insensitive root compare (debug.mjs:28,35,350,437,472). The runner pid walk spawns PowerShell per `lock acquire` (slow, fragile).
- Hardcoded WildEra: MANIFEST dirs, `WildEra` data dir, engine scripts and flag table, `WildEraEditor` provenance, `Saved/Logs` audit, filter regex `WildEra.*`, shared-file list in the prompt (debug.mjs:22-23,28,173-227,770,798-799,977).
- `treeState()` re-hashes every changed file (including large binary assets) on each call and is called many times per turn, run and acceptance step; `maxBuffer` 1 GiB; no caching (debug.mjs:47-57,1 << 30).
- `snapshotTake` stores a full copy of every changed file under LOCALAPPDATA per snapshot and per revert; no retention or cleanup; `staged.patch` is written and recorded but never read (debug.mjs:229-240).
- Unbounded growth of session files: `fauna-corpse-handoff.md` is 157 KB and its state.json 248 KB, test logs 275 KB per run, 4 MB of runs; the md is the debugger's brain and is re-read each turn (listing of wildera:.planning/debug, not read).
- Possible name mismatch: the supervisor archives agents matching `^gsd-debug:` and `writers()` blocks on `^(code-wave|gsd-plan|gsd-debug):` or `/coder|debugger|fixer/i`, while the workflow's agent label is `Debug:<slug>` with session `debugger:<slug>`; whether Paseo's agent name starts with `gsd-debug:` was not verified (debug.mjs:376,897; gsd-debug.js:212).
- CONFLICT (code vs design note): `gsd-debug.js:220` uses `Date.now()` as a fallback while DESIGN.md says ph workflow scripts have no `Date.now`/`Math.random`/fs (wildera:_workspace/gsd-port/DESIGN.md:178-179); only reached when a turn window is missing.
- Dead/odd code: `renderPrompt` is defined after the `switch` (works only through function hoisting) (debug.mjs:952-980); `if (sub === 'invocation' && a[0] === 'end')` repeats the case label (:632); `slug()` is called for every sub except `create|list|lock` so `exec/supervise/recover` also need `--slug` (:546); usage string omits `exec`, `supervise`, `recover` (:949); `st.builds` (initialised `{}` at :615) is never read (grep: `.builds` only appears as the budget view's computed count); header comment of debug.mjs lists no `exec`/`grant`/`supervisor`/`deadline` (:4-11).
- `awaitResult` busy-polls from inside the CLI with a fixed 120 s grace; `shell()` call asks `tailChars: 4000000` (gsd-debug.js:45) — an output cap that large suggests output truncation problems were hit; cause not stated.
- Two parallel truth sources (md frontmatter status vs state.json status vs registry status) can drift (see GDB-55).
- Resume semantic depends on the native `--resume <runId>` of the workflow runner (SKILL.md:61); under `ph` the replay model (turn/decision records) must be re-validated.
- `debug status` mixes validity of the debugger's file with session metadata; callers must read both `valid` and `session` (debug.mjs:621-625).
- Dead end shown by a real session: the empty-delta case has no resolution path except a manual owner decision (GDB-59).
- `_workspace/gsd-debug/scene-readiness/signature.json` exists with no session in the registry (prepared but never created, or deleted); `fauna-corpse-handoff` args-ck7..ck10 files suggest many manual re-invocations (inferred from file names only; contents not read).
- The `fill` helper's conditional syntax `{if resume: "..."}` is parsed by regex; unknown placeholders are left in the prompt verbatim (`String(v[k] ?? m)`) (debug.mjs:957-958).
- Multi-runtime shim text (Codex/Cursor/OpenCode homes) inside generated `forensics.md` and `gsd-debugger.md` archive step is dead weight for a Claude-Code-only kit (forensics.md:282; gsd-debugger.md:966).

## Open questions for the owner

1. Experiment kinds in the generic core. The debug core hardcodes Unreal build/test/scenario requests. Options: (a) core ships a declarative experiment-kind table in the project adapter (script, field schema, validators, result evaluator) and WildEra supplies the Unreal one; (b) core only supports "named project commands" with a free-form result; (c) keep Unreal-specific code in the kit. Recommendation: (a), since runs, budget, deadline, provenance and revert-and-reconfirm are generic and only the three evaluators are project-specific.
2. Empty fix delta (fix already in the dirty tree before the baseline; GDB-59). Options: (a) add a main-session command to adopt named hunks/files into the reversible delta; (b) let the baseline be taken from HEAD with an explicit list of excluded inherited files; (c) leave as owner-only decision. Recommendation: (a), with the owner checkpoint recorded in the session.
3. Lease scope. Machine-wide single lease blocks all projects and roots; per-root with a shared engine lock is the alternative. Options: machine-wide (old), per code root, per project plus a separate engine mutex. Recommendation: per code root for the lease plus a machine-level engine mutex only if the engine (UE editor/GPU) is shared.
4. Where bulky run artifacts live (run logs, 275 KB test logs, turn prompts, snapshots). Options: keep in `.planning/debug/<slug>/` (committed or ignored?), move under `_workspace/` (gitignored), or a machine data dir. Recommendation: `.planning/debug/<slug>.md` + state.json + registry + KB tracked; runs/turns/snapshots untracked under `_workspace/`/machine dir, with a retention rule.
5. Dropped upstream features: TDD mode, MemPalace semantic recall, specialist skill dispatch, SBFL, mutation check. Options: stay dropped (old) or make TDD/mutation adapter-optional. Recommendation: stay dropped except the mutation-check reason as an adapter key.
6. Forensics report naming and location: old uses `.planning/forensics/<date>-<slug>.md` in the planning checkout (upstream `report-<timestamp>.md`). Options: keep old name, use upstream name. Recommendation: keep the old dated-slug name; also confirm that skipping the GitHub-issue step stays (outward-facing).
7. Digest mechanism. Old digest uses `git diff` with stat-cache workarounds (the mtime bump, GDB-04). Options: keep git-based digest plus the bump, or hash file bytes of the manifest directly. Recommendation: hash bytes directly when the manifest is small enough, else keep git plus the bump.

## Revision log r1

| finding ID | accepted / rejected | what changed (behavior IDs) or why rejected |
| --- | --- | --- |
| R1-GDB-01 | accepted | GDB-32 rewritten: KB entry is appended; no second write if the heading exists and the session was never reopened; a reopened session appends again and both entries remain; header text hardcoded (debug.mjs:874-878 re-read). |
| R1-GDB-02 | accepted | GDB-19 corrected (only a new invocation record clears `binaries`); new GDB-63 for resumed-invocation semantics (debug.mjs:637-642,674-676). |
| R1-GDB-03 | accepted | GDB-34 corrected: code-wave compared by `args.cwd` root, gsd-plan/gsd-verify by `ctx.HARNESS`, unknown names block regardless, gsd-debug skipped only for own slug, own runner pid skipped (debug.mjs:359,363-366). |
| R1-GDB-04 | accepted | New GDB-64; GDB-35 points to it; the `Debug:<slug>`/`debugger:<slug>` name-mismatch concern is kept (debug.mjs:899,918,929). |
| R1-GDB-05 | accepted | New GDB-61 (two clocks, default `shell()` timeout 600 s); GDB-36 arg annotated (gsd-debug.js:42-45,73; debug.mjs:612,773-775). |
| R1-GDB-06 | accepted | New GDB-60 (answer written to md before the wall check, no save on refusal, human-verify confirmation blocked); GDB-20 annotated. Verified the earlier `budget` refusal at 654 returns before the md write (656-658), as the reviewer says. |
| R1-GDB-07 | accepted | New GDB-66 (`authorizedDelta` and `resolution` survive reopen; reconcile reads all state files, debug.mjs:82-84,563-570,879); GDB-10 annotated. |
| R1-GDB-08 | accepted | New GDB-62; GDB-22 caveat added. Verified in the vendored manager: Step 2 block has `goal: {goal}` (lines 89-93), the 3d block has `goal: find_and_fix` and no symptoms placeholder (lines 250-278). |
| R1-GDB-09 | accepted, with one part not carried | GDB-14 test corrected (reserve = non-build items + `revertRuns`, 0 when the signature kind is `build`; debug.mjs:341-342,614,750-753); GDB-31 now says the red run is the first `signature` item only (gsd-debug.js:119-127,144-145). NOT carried: the claim that the build-signature case "can hit budget-exhausted mid-attempt": when the signature item is a `build`, red/green are build requests, and builds are never counted against the run budget (debug.mjs:750-753 apply to `tq.kind !== 'build'`), so only the reserve rule and the first-item rule hold. |
| R1-GDB-10 | accepted | New GDB-65 (deadline -> deadlineStop; turn-cap checkpoint key `<inv>:turn-cap`; else failed; stored decision replays without audit, gsd-debug.js:200-208); GDB-38 points to it. |
| R1-GDB-11 | accepted | GDB-26 now describes `isShared` as the regex pair in gsd.mjs:463-465 (read in r1), the prompt text as wider, and the `ownedPrefixes` throw path. |
| R1-GDB-12 | accepted | GDB-18 corrected (false when `passed !== false`; no-match = false; null cases; crash and build matching details; debug.mjs:445-468); GDB-17 FPS evidence refined (debug.mjs:490-493). |
| R1-GDB-13 | accepted | GDB-05 rationale now points at the comment on debug.mjs:98 (`upstream 213-234`). |
| R1-GDB-14 | accepted | New GDB-67 (envelope `{status:'error', error}`, exit 69 on a non-git `--root`, `init.debug` payload; gsd.mjs:871-873,945-953,1066-1068) and GDB-68 (lock record fields, `renew --supervisor`, `clear` with no lock); GDB-56 and GDB-33 point to them. |
| R1-GDB-15 | accepted | Coverage table now shows the reader line counts (998, 319, 293, 287, 182) next to `wc -l`; two outside-scope files read in r1 added to the table (gsd.mjs ranges, session-manager blocks). |
| R1-GDB-16 | accepted | GDB-04 now has a single KEEP proposal with the exact bump formula (debug.mjs:256-260); the bytes-hash alternative moved to new Open question 7. |

