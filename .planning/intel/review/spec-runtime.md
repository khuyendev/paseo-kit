# Spec review: RTM

## Verdict
REVISE; 7 BLOCKER, 12 MAJOR, 0 MINOR.

The inventory is structurally complete: all 128 distinct behaviors assigned to M4–M6 appear once, and the two outright exclusions (RUN-18 and WFL-48) are justified. The substantive contracts are not yet safe to implement. In particular, worker launch implicitly activates an unselected plugin, workflow admission does not enforce the caller-wide running cap, retained sessions can deadlock admission, workflow role selection lacks a usable interface, and per-call worktrees conflict with persistent sessions. The specification also retains a superseded instruction to trim method recipes, contrary to D-111. The remaining findings concern incomplete validation and shell contracts, incompatible configuration/interfaces, session recovery, and a watchdog classification regression. No project/engine/game-specific runtime content was found that independently violates D-110.

## Findings

### SR-RTM-01 MAJOR coverage Trusted-script limits are lost behind an absolute sandbox claim
- Severity: MAJOR
- Category: coverage
- Target: RUN-70 → FLOW-02, FLOW-44 (missing trusted-code limitation).
- Evidence: map/runtime.md:545–548 explicitly keeps the limitations that workflow scripts are trusted code, `node:vm` is not a security boundary, and a busy loop can hang the runner. FLOW-02 instead promises “no ... file or network access”; FLOW-11 deliberately exposes arbitrary host commands through `shell()`. FLOW-23 covers un-awaited agents, not the trust boundary. The RUN-70 trace therefore covers only part of the behavior.
- Fix: State that scripts are trusted project code, that direct ambient import/fs/network APIs are unavailable but `shell()` intentionally executes host commands, and that the determinism guards are not a security sandbox. Put the trusted-code/busy-loop warning in the adapter runtime guide and trace RUN-70 to it. Do not require a new security sandbox.

### SR-RTM-02 MAJOR testability The replacement JSON-schema validator has no defined dialect
- Severity: MAJOR
- Category: testability
- Target: FLOW-13.
- Evidence: WFL-11/RUN-67 previously delegate actual validation to Ajv; D-30 changes the implementation, not the obligation to validate. FLOW-13 specifies the root shape and required-key check but neither supported keywords nor handling of unsupported schemas. Its acceptance checks only a missing required property. A validator that ignores nested types, enum, arrays, or additional properties could pass it while accepting invalid GSD results.
- Fix: Define the supported JSON-schema subset needed by shipped workflow schemas, recursive semantics, and fail-closed handling of unsupported keywords. Add valid/invalid fixtures for each supported construct, nested structures and invalid JSON, plus a scan proving all shipped schemas fall within the subset. Require the same schema meaning for native `outputSchema` and the retry validator.

### SR-RTM-03 MAJOR testability shell() does not define its command interpreter or a reproducible failure check
- Severity: MAJOR
- Category: testability
- Target: FLOW-11; M10/ADPT-02 consumer boundary.
- Evidence: HIS-23 and INGEST-CONFLICTS W-03 adopt a host command primitive; the cited field implementation uses `exec(cmd)` (WildEraV6/.agents/harness/runtime/workflow_engine.mjs:248–263). FLOW-11 does not say whether `cmd` is a shell string or an argv vector, which shell parses it on Windows/POSIX, or how quoting works. Its “missing binary -> -1” acceptance conflates failure to launch the shell with the shell successfully reporting a command-not-found exit. ADPT-02 separately requires adapter commands to be argv arrays executed without a shell.
- Fix: Define the shell-string/interpreter contract and distinguish launch failure (-1) from a launched command's nonzero exit. Name the adapter-to-host path for no-shell argv execution rather than implying arrays can be passed to an unspecified `shell(cmd)`. Test spaces, metacharacters, stdin, a real nonzero command, launch failure, and timeout of a command that spawns a child (assert the child is gone, not merely that the promise returned).

### SR-RTM-04 BLOCKER decision Worker launch activates copied but unselected file tools
- Severity: BLOCKER
- Category: decision
- Target: PCLI-09 and its acceptance matrix.
- Evidence: RUN-61 requires `copied && !disabled && (enabled || direct)` before injecting the mod directory, and suppresses duplicate native registration. PCLI-09 instead injects whenever copied, not disabled and unregistered, explicitly including owner selection “unset.” That turns a plain copy into activation despite D-02, INV-05, and owner memory no-kit-overrides-of-tool-settings.md:11–14. RUN-26 also says the effective provider env (including inheritance) is the base for mod selection; PCLI-09 does not identify that base.
- Fix: Restore an affirmative owner-selection/direct-env condition; copied + unset + no direct selection must remain inactive. Resolve `CLAUDE_CONFIG_DIR` and existing plugin dirs from the effective worker-provider env, including inheritance, before reading settings. Test unset, explicit false, enabled, direct, native registration, missing registration assets, and a worker config dir different from the invoking process; no setting is written or implicitly enabled.

### SR-RTM-05 BLOCKER decision GSD-only recipe trimming contradicts the restored method carriage
- Severity: BLOCKER
- Category: decision
- Target: FLOW-44; WFL-44 and WFL-45 traceability rows.
- Evidence: FLOW-44 says “recipes trimmed to the ones the GSD scripts use.” D-111 points 1 and 4 and its reversal paragraph restore unchanged method references, team patterns/examples and workflow invocation material; only the named adapter layer may change. WFL-45 maps judge-panel, loop-until-dry, adversarial and budget-aware recipes, not merely GSD recipes. The existing trace gives no preserved-method requirement for those behaviors; WFL-44 similarly points only to consent. HARN-01/HARN-02 in method.md already define unchanged carriage and enumerated adapter edits.
- Fix: Remove the instruction to trim carried recipes. Preserve their method content and identify only runtime-path, primitive, config and non-Claude-adapter edits in NOTICE. A new short `ph` index may link to the unchanged references without replacing them. Add the appropriate HARN-01/HARN-02 cross-references to WFL-44/WFL-45 so the restored method behaviors are actually traced.

### SR-RTM-06 BLOCKER decision Workflow concurrency ignores the caller's already-running agents
- Severity: BLOCKER
- Category: decision
- Target: PHCL-23, FLOW-14.
- Evidence: D-20/INV-12 and RUN-11/RUN-29 bound running agents of one orchestrator. PHCL-23 counts caller-owned agents, but FLOW-14 gives each run a semaphore of the full `max_subagents` and checks only budget, run cap and live cap around it. With 20 existing running teammates, a workflow can start another 20 under the live cap of 40. This is not the separately deferred check-then-create race: it fails even with one new workflow and a stable daemon snapshot.
- Fix: Make workflow admission use caller-wide free running capacity, including existing teammates and other runs, while retaining the run's rolling semaphore. Check/reserve available capacity before creation and release the run reservation after accounting. Add an offline case with 19 existing running agents and multiple queued workflow calls: at most one new call starts until caller-wide capacity is released.

### SR-RTM-07 BLOCKER consistency Live-cap waiting can prevent a run from ever ending
- Severity: BLOCKER
- Category: consistency
- Target: FLOW-14, FLOW-12, PHCL-24, PHCL-10.
- Evidence: PHCL-24 requires refusal at the live cap; FLOW-14 changes that to waiting without a deadline or terminal condition. FLOW-12 retains every successful session until run end. After 40 distinct sessions have completed their first calls, call 41 waits forever for an archive that occurs only at run end. A `keep:true` workload has the same problem. Reusing an existing idle session does not allocate a new live agent, but the admission contract does not exempt it.
- Fix: Separate running-turn admission from allocation of a new live agent. Existing-session reuse must not consume an additional live slot. When a new live slot cannot become available within the run's policy, return a named bounded failure/escalation rather than wait indefinitely or silently archive retained context. Specify the same live-cap behavior for collect-mode fanout, including `--keep`. Test more than 40 sequential session keys and reuse at a full live cap.

### SR-RTM-08 BLOCKER consistency Workflow calls cannot express the specified role precedence
- Severity: BLOCKER
- Category: consistency
- Target: PHCL-22, FLOW-04, FLOW-15; ADPT-11 and GSDF-18.
- Evidence: PHCL-22 promises one selector for every CLI/workflow agent but defines role input only as `--role` / fanout `role=`. FLOW-04's exhaustive allowed options omit `role`; it specifies no alternative inference from agentType or workflow stage. GSDF-18 requires distinct outline/planner role selection, and ADPT-09 permits project agent types, so agent type cannot safely be assumed to equal a role. PHCL-22 also errors on a missing table entry whereas ADPT-11 explicitly requires fallback to the agent tier (D-16 precedence).
- Fix: Define one explicit role input for workflow calls (for example `opts.role`) and carry it through the shared selector; distinguish an invalid role name from a valid role with no override, which falls back. Resolve model and effort independently by the documented precedence and include the effective execution choices in cache identity. Test the outline/planner split with the same agent type, a project replacement type, a missing role override and an explicit per-run override.

### SR-RTM-09 MAJOR consistency Appended project prompt notes cannot be recovered from the specified merged config
- Severity: MAJOR
- Category: consistency
- Target: PHCL-29; CONF-04 and CONF-11.
- Evidence: RUN-23/S-17 require kit base plus appended project note. PHCL-29 calls the base `first_prompt_note` but never names the overlay key. CONF-04 replaces every non-map key wholesale, and CONF-11 calls `first_prompt_note` the kit base. If a project uses the existing overlay key, the loader replaces the base; if it invents an append key, closed validation rejects it. The general instruction at runtime.md:12 does not supply the missing key/merge contract.
- Fix: Name and type the two inputs and define their effective composition with M3 (either a distinct project append key or an explicit special merge/provenance rule). Add an integration test through `loadConfig` and actual prompt assembly, not just a preassembled fixture, proving a project note never deletes or duplicates the kit base.

### SR-RTM-10 MAJOR consistency Context ROTATE has two different defaults and no shared key
- Severity: MAJOR
- Category: consistency
- Target: PHCL-16; PANL context-threshold requirement (tools.md:783–784), CONF-11.
- Evidence: D-97 requires one source of truth. PHCL-16 says the shared rotate threshold ships at 50 without naming a key. The panel requirement uses `context_guard.start_pct`; CONF-11 ships that at 60 (D-48). Thus a 55% agent is ROTATE in `ph` but not in the panel even with untouched defaults.
- Fix: Name the single threshold and its config scope, remove the independent 50 default, and align `ph` and the snapshot consumer. Explicitly define whether project overrides affect each consumer. Add one shared-fixture test at values below, equal to and above the threshold, including an overlay change.

### SR-RTM-11 BLOCKER consistency Persistent sessions and per-call worktrees point at different code trees
- Severity: BLOCKER
- Category: consistency
- Target: FLOW-12, FLOW-27, PHCL-31; GSDF-18 and ADPT-13.
- Evidence: FLOW-27 creates `<runId>-<n>` per call. FLOW-12 sends only the new task prompt to the same session agent, and PCLI-16 changes only its model. The second call in a worktree-isolated coder/fixer session therefore creates a new tree but leaves the reused agent in the first tree with the first worktree instruction. ADPT-13 defaults GSD isolation to worktree, so this affects the principal execution path, not an unused combination.
- Fix: Define worktree lifetime and identity for sessions: retain/reuse the same worktree with the session (including adoption on resume), or explicitly reject an unsupported combination before creating anything. Never create an unused worktree for a reused agent. Test two coding/fixing calls and a resumed call against a real temp git repo: they must edit the intended same tree and leave no extra tree.

### SR-RTM-12 MAJOR consistency Session reuse has no compatibility rule for role, permissions or schema
- Severity: MAJOR
- Category: consistency
- Target: FLOW-12, FLOW-13, PCLI-16.
- Evidence: HIS-16 keeps context; HIS-17 only settles model readback. The new contracts allow the same session key with a changed agentType/include body, `readOnly`, cwd or schema, but send only the new prompt and update only the model. In particular, FLOW-13 installs native `outputSchema` at creation with no contract for a later different schema. The old role/denies/native output constraint can remain while the log and validator describe the new options. INV-22 forbids reuse for incompatible inputs.
- Fix: Specify which session properties are immutable and which can be updated with verified daemon support. Refuse or deliberately create a fresh full-prompt session on incompatible role/cwd/permission changes. For changing schemas, use a session-compatible validation path or require verified native-schema updates; do not silently retain the first schema. Add two-call fixtures changing each property, including a writable call after a read-only one and two distinct schemas.

### SR-RTM-13 MAJOR consistency Resumed session ownership and transcript attribution are underspecified
- Severity: MAJOR
- Category: consistency
- Target: FLOW-12, FLOW-25, FLOW-41, PHCL-20, PHCL-28.
- Evidence: HIS-16 explicitly adopts an earlier run's agent. PHCL-28 stamps the run/call tag in the first full prompt only; FLOW-12 says subsequent calls send only their prompt. FLOW-41 identifies transcripts solely by the exact current `Run <runId> #<n>` tag, while PHCL-20 archives by the current `harness.run` label. No adoption step says how the old label/tag becomes attributable to the new run. The supplied acceptance fixtures never exercise stats or `archive --run` after adoption.
- Fix: Define current-run ownership and per-call attribution on adoption without destroying session context: update verified labels or maintain a durable run-owned agent index used by archive, and record current-call transcript attribution (or explicitly mark unavailable rather than silently omitting it). Test resume of a cached session followed by a live continuation, then stats and `archive --run <newRun>`; the reused agent must be attributed and stopped/archived by the new run.

### SR-RTM-14 MAJOR consistency Custom run directories cannot be watched or measured through the documented CLI
- Severity: MAJOR
- Category: consistency
- Target: FLOW-20, FLOW-21, FLOW-40, FLOW-41.
- Evidence: WFL-16/WFL-18 expose `--runs-dir`. FLOW-40 reads `<runs-dir>` but its command surface has no `--runs-dir` or other resolution rule; FLOW-41 likewise has no way to select it. FLOW-21's “exact” wait hint drops the chosen directory. A valid detached run in an alternate directory produces a watcher that reports it missing after 60 seconds. PHCL-20 already fixes the analogous archive interface.
- Fix: Add `--runs-dir D` consistently to watch-run and run-stats (or specify an equally explicit shared discovery contract) and propagate it into detached wait/recovery hints. Test a detached run entirely outside `_workspace/_runs`: its printed command must follow it to completion, stats must read it, and archive must address the same directory.

### SR-RTM-15 BLOCKER consistency A redirected build is incorrectly subject to the file-tool hang limit
- Severity: BLOCKER
- Category: consistency
- Target: FLOW-32 and FLOW-35.
- Evidence: WFL-37 explicitly applies the short file limit to read/write-kind **non-shell** tools and preserves the long limit for shells. FLOW-32 reclassifies Bash commands with `>`/`>>` or write helpers as `write`; FLOW-35 then applies 180 seconds to read/write kinds without retaining the non-shell exclusion. A normal `build > build.log` lasting four minutes is cancelled as a hung file tool, violating INV-20 and HIS-02's shell-duration lesson.
- Fix: Preserve shell origin independently of the read/write activity classification. Bash/PowerShell execution always uses `agent_tool_stuck_s`, even when its write classification resets reread counters. Add a redirected 400-second Bash fixture: counters reset as a write, but no interrupt occurs under the 900-second shell limit; a genuine file tool still interrupts after 180 seconds.

### SR-RTM-16 MAJOR consistency The injected engine interface cannot express its new host responsibilities
- Severity: MAJOR
- Category: consistency
- Target: FLOW-43 with FLOW-09, FLOW-12, FLOW-14 and FLOW-15.
- Evidence: WFL-49 requires a testable engine/runner boundary. FLOW-43 enumerates `runWorkflow({script,args,runner,out,extraSpent,resolveChild,cache,journalPath,clock})`, but does not identify how the engine receives the run id, configured admission limits/budget, resolved role/model cache identity, or how it tells the session-owning runner about a cached session adoption. Cached hits explicitly skip the runner (FLOW-14). The field extension used an `onCachedSession` host callback (WildEraV6/.agents/harness/runtime/workflow_engine.mjs:287–295); that capability is missing from the stated boundary.
- Fix: Complete the engine/host interface with the required run/config inputs and host interactions for pre-cache resolution and cached-session adoption, while keeping daemon operations out of the engine. Do not prescribe callback names unnecessarily. Add a pure-engine test with non-default limits and a host spy proving a cache hit adopts the recorded session without executing the agent runner.

### SR-RTM-17 MAJOR consistency The ban on all other Paseo imports forbids the specified plugins
- Severity: MAJOR
- Category: consistency
- Target: PCLI-01.
- Evidence: PCLI-01 says no other **kit module** imports any `@getpaseo/*` path or talks to the daemon. SYNTHESIS M13 and UI-01/UI-05 require plugins built on `@getpaseo/plugin` and the daemon-provided plugin SDK. The acceptance scan is only over `ship/`, so it would miss this contradiction while an implementer following the prose could route plugins through M4, reversing the specified dependency boundary.
- Fix: Scope the rule to direct daemon-client imports/transport for the installed runtime (M4–M10), explicitly excluding M13's host-provided plugin SDK. Preserve the intended M13 read-only host interface; make the import test distinguish `@getpaseo/cli`/client internals from approved plugin SDK imports.

### SR-RTM-18 MAJOR consistency Enforced read-only denies conflict with the named-output exception
- Severity: MAJOR
- Category: consistency
- Target: PHCL-27; PCLI-07.
- Evidence: RUN-20's note permits output files named by the prompt; WFL-51 says checks that write artifacts need an editing role scoped to those artifacts. PHCL-27 keeps the exception but, when supported, denies all six writing tools unconditionally, with no output-file path exception or caller routing contract. Its manual acceptance only tries an Edit that must fail, so it cannot detect a reviewer unable to write its required report. PCLI-07's enumerated creation payload also omits the per-agent deny field PHCL-27 requires.
- Fix: Define the supported report-writing path under enforced read-only mode: return the report for the orchestrator to write, use a distinct scoped editing role, or use verified path-scoped permissions if supported. Align the runtime note and creation payload with that choice. Test both refusal to mutate an input and successful production of the required named report without disabling the read-only protection.

### SR-RTM-19 MAJOR over-spec Targeted cleanup is tied to a repository-wide Git command
- Severity: MAJOR
- Category: over-spec
- Target: PHCL-32.
- Evidence: RUN-56's concern (map/runtime.md:450) is precisely that `git worktree prune` prunes every stale record in the repo. PHCL-32 mandates “git worktree prune limited to that entry,” although that command does not provide a per-worktree target. The safety acceptance is useful; the named implementation cannot establish it.
- Fix: Require the observable contract—remove only the selected missing worktree's registration, preserve unrelated registrations, delete its branch only with safe merged checks—without mandating targeted `git worktree prune`. Keep the unrelated-stale-record fixture, and require the implementation to use a supported targeted cleanup mechanism or conservatively keep/report an entry it cannot safely remove.

## Traceability rows checked

The table below checks all 128 claimed rows against the maps and controlling decisions. “Wrong” includes partial coverage or a substantive contract defect, not only an incorrect ID. “OK” means the mapped behavior is represented; it does not certify unrelated requirements on the same implementation.

| Behavior ID | Requirement claimed | OK / wrong (why) |
| --- | --- | --- |
| RUN-11 | PHCL-23 | Wrong: running-cap contract does not extend to existing caller agents when a workflow starts; SR-RTM-06. |
| RUN-12 | PCLI-05 | OK: fully rendered UTF-8 bound and pre-request check. |
| RUN-13 | PHCL-21 | OK: tiers/explicit IDs, worker-provider mapping and effort resolution; aliases dropped per D-16. |
| RUN-14 | PHCL-21, PHCL-04 | OK: normalized allowlist and doctor default-tier check. |
| RUN-15 | PCLI-10, PHCL-04 | OK: nearest thinking level, high tie, no implicit off, catalogue failure does not block creation. |
| RUN-16 | PHCL-04; operational flow documentation only | OK: map explicitly proposes documentation/doctor hint rather than a new command. |
| RUN-17 | PCLI-07 | OK: mode and tier features retained; non-Claude maps dropped. |
| RUN-18 | Not a requirement: S-01 | OK: non-Claude provider heuristics explicitly dropped. |
| RUN-19 | PHCL-26 | OK: one definition directory, include validation and documented parser; W-02 overrides map directory proposal. |
| RUN-20 | PHCL-27 | Wrong: read-only enforcement and output exception need a coherent contract; SR-RTM-18. |
| RUN-21 | PHCL-28 | OK: role/includes/task/notes order and omission of definition metadata. |
| RUN-22 | FLOW-28 | OK: priming safety notes retained, default off per D-24. |
| RUN-23 | PHCL-29 | Wrong: base/append key and loader composition not defined consistently; SR-RTM-09. |
| RUN-24 | PHCL-30 | OK: teammate note retained, project-root wording correctly omitted. |
| RUN-25 | PCLI-01, PCLI-02, PCLI-04 | Wrong in scope: CLI isolation is represented but the universal SDK ban contradicts M13; SR-RTM-17. |
| RUN-26 | PCLI-07, PCLI-08, PCLI-09, PCLI-11 | Wrong in env portion: owner selection/effective worker-provider env not preserved; SR-RTM-04. Other payload/parent-label/tracking clauses represented. |
| RUN-27 | PCLI-11 | OK: creation subscription, pre-turn baseline, dedup and late settlement. |
| RUN-28 | PCLI-06 | OK: required caller and creation refusal. |
| RUN-29 | PHCL-23, PHCL-24, PHCL-25 | Wrong in admission integration: run-local cap and unbounded live-slot waiting; SR-RTM-06/07. Name checks represented. |
| RUN-30 | PCLI-15 | OK: own-pool priority, prefix/ambiguity rules; restricted UUID fallback is the explicitly permitted synthesis choice. |
| RUN-31 | PCLI-12, PCLI-13 | OK: outcomes plus five-step retry schedule from W-04. |
| RUN-32 | PCLI-14 | OK: denial text, three statuses, other permissions fail. |
| RUN-33 | PCLI-05 | OK: outbound send is size checked. |
| RUN-34 | PHCL-01 | OK: single entry, public help, exits and close-in-finally. |
| RUN-35 | PHCL-02 | OK: argument consumption and usage failures. |
| RUN-36 | PHCL-03 | OK: exclusive prompt inputs and BOM stripping. |
| RUN-37 | PHCL-04 | OK: Claude-relevant doctor checks, invalid-overlay continuation, adapter check. |
| RUN-38 | PHCL-05 | OK: preflight of all names/capacity, parallel spawn and per-item results. |
| RUN-39 | PHCL-06 | OK: cwd instruction and daemon field, named verification check. |
| RUN-40 | PHCL-07 | OK: nonblocking wait hint and unified renderer. |
| RUN-41 | PHCL-08 | OK: preamble/block grammar and unknown-option refusal. |
| RUN-42 | PHCL-09, PHCL-10 | OK for mapped fanout behavior: filename collision checks, rolling collect, collect-before-archive and finally cleanup. New live-cap integration needs SR-RTM-07. |
| RUN-43 | PHCL-11 | OK under D-38: idle-follow-up guidance, wait before send, explicit interrupt option. |
| RUN-44 | PHCL-12 | OK: per-agent terminal lines and summary; unused tracker removed. |
| RUN-45 | PHCL-13 | OK: result shape, tracked-only totals and final reply; costs separated per D-23/D-37. |
| RUN-46 | PHCL-15 | OK: required caller, listing and explicit empty result. |
| RUN-47 | PHCL-16 | Wrong: the old 50 default survives despite the different shared threshold; SR-RTM-10. |
| RUN-48 | PHCL-17 | OK: detached arming, configured resume, one watcher and no autocompact override. |
| RUN-49 | PHCL-18 | OK: measured drop, no retry, failure report and lock release. |
| RUN-50 | PHCL-19 | OK: cancellation preserves agent/context. |
| RUN-51 | PHCL-20 | OK for ordinary run ownership; adopted-session ownership requires SR-RTM-13. |
| RUN-52 | PHCL-01 | OK: single installed entry with no kit-checkout fallback. |
| RUN-53 | PHCL-35 | OK: task store, locks, dependencies and ephemeral scope; v1 retention is allowed by D-18. |
| RUN-54 | PHCL-36 | OK: freeze/check file contract; v1 retention is allowed by D-21. |
| RUN-55 | PHCL-31 | OK for fresh-agent creation and failed-create cleanup; session/worktree composition requires SR-RTM-11. |
| RUN-56 | PHCL-32 | Wrong: scoped safety is tied to an unavailable targeted prune operation; SR-RTM-19. |
| RUN-58 | FLOW-20 | OK: workflow command/resume surface and improved preflight. |
| RUN-59 | FLOW-40, FLOW-41 | Wrong: custom runs-dir interoperability is absent; SR-RTM-14. |
| RUN-60 | PHCL-34 | OK: platform capability gate, Claude CLI lookup and Windows shim handling. |
| RUN-61 | PCLI-09, PHCL-04 | Wrong: copied/unset mod is activated and the eligibility matrix blesses it; SR-RTM-04. |
| RUN-64 | FLOW-34, FLOW-38 | OK: limits and real switch are represented; shell-origin distinction needs SR-RTM-15. |
| RUN-65 | FLOW-38, PHCL-22 | OK: project-specific values not carried; generalized switch/roles retained. Role interface defect is SR-RTM-08. |
| RUN-66 | PHCL-14 | OK: project-maintained prices, list vs reported cost and unknown-price null. |
| RUN-67 | FLOW-13 | Wrong: own validator's supported semantics remain undefined; SR-RTM-02. |
| RUN-68 | FLOW-28 | OK: warm-up identity/gate and timer cleanup, defaults off. |
| RUN-69 | FLOW-21, FLOW-24, FLOW-25, FLOW-26 | OK: log routing, transport-loss nulls, lifecycle and null reasons; budget separately FLOW-09. |
| RUN-70 | FLOW-09, FLOW-15, FLOW-23 | Wrong: trusted-code/security-boundary limitation not carried; SR-RTM-01. |
| WFL-01 | FLOW-01 | OK: anchored literal metadata, BOM and line preservation. |
| WFL-02 | FLOW-02 | Wrong in wording: direct-API determinism guards are represented, but absolute no-file/network promise conflicts with shell and trusted code; SR-RTM-01. |
| WFL-03 | FLOW-03 | OK: value failures vs configuration throws and parallel/pipeline handling. |
| WFL-04 | FLOW-04 | OK for old options plus session; new all-agent role-selection promise has no workflow input, SR-RTM-08. |
| WFL-05 | FLOW-05 | OK: independent item pipelines, null passthrough, order and limit. |
| WFL-06 | FLOW-06 | OK: barrier, item failure isolation and input limit. |
| WFL-07 | FLOW-07 | OK: phase state/warning and log; parallel-phase caution separately FLOW-44. |
| WFL-08 | FLOW-08 | OK: CLI/nested/resumed args and mutually exclusive flags. |
| WFL-09 | FLOW-09 | OK: output-token pool including orchestrator, admission check and overshoot disclosure. |
| WFL-10 | FLOW-10 | OK: one-level nesting, shared accounting and single saved-script location. |
| WFL-11 | FLOW-13 | Wrong: validator dialect and recursive acceptance missing; SR-RTM-02. |
| WFL-12 | FLOW-14 | Wrong in new cap composition: caller-wide running capacity and retained-session progress not established; SR-RTM-06/07. |
| WFL-13 | FLOW-15, FLOW-16 | OK: occurrence-indexed successful cache entries, resumed script/args and empty journal support. |
| WFL-14 | FLOW-15 | OK: resolved role/includes hash and provider/model invalidate cache per D-29. |
| WFL-15 | FLOW-17 | OK: append-only start/finish journal with result, reason, usage and in-flight visibility. |
| WFL-16 | FLOW-18 | OK: run layout, statuses and atomic writes. |
| WFL-17 | FLOW-19 | OK: host-generated run ID and override. |
| WFL-18 | FLOW-20 | OK: command and exit contract, earlier validation failures deliberately improved. |
| WFL-19 | FLOW-21 | Wrong for nondefault directory: printed follow command cannot locate the run; SR-RTM-14. |
| WFL-20 | FLOW-22 | OK: stable progress grammar and null failures visible to the watcher. |
| WFL-21 | FLOW-23 | OK: JSON return, failure journal retention and drain of un-awaited calls. |
| WFL-22 | PHCL-28 | OK for fresh agents; attribution of reused/resumed sessions needs SR-RTM-13. |
| WFL-23 | FLOW-28 | OK: two-turn mechanism and safe default per D-24. |
| WFL-24 | FLOW-28 | OK: keyed gate, failure release and cleared fallback timer. |
| WFL-25 | PCLI-05 | OK: fully rendered prompts, wrappers and watchdog messages bounded. |
| WFL-26 | PCLI-12, PCLI-13, PCLI-14 | OK: waiting/errors/permission outcomes with W-04 retry override. |
| WFL-27 | FLOW-24 | OK: no reconnect; later live calls fail as null without new agents. |
| WFL-28 | FLOW-25 | OK for fresh calls: labels/env/watchdog/finally archive; adoption integration needs SR-RTM-13. |
| WFL-29 | FLOW-27, PHCL-32 | Wrong in composition: worktree lifetime conflicts with sessions; cleanup mandates unsupported targeted prune; SR-RTM-11/19. |
| WFL-30 | FLOW-29 | OK: union of ready tool spans, prompt basis and shared ticker cleanup. |
| WFL-31 | FLOW-30 | OK: complete-input clock, typed-detail mapping and incident replay. |
| WFL-32 | FLOW-31 | OK: finished IDs and duplicate/late-event guards. |
| WFL-33 | FLOW-32 | Wrong when combined with FLOW-35: shell writes lose their long timeout; SR-RTM-15. |
| WFL-34 | FLOW-33 | OK: one signal per kind/prompt and write-reset ordering. |
| WFL-35 | FLOW-34 | OK: model-time nudge/stop thresholds and disable-by-zero. |
| WFL-36 | FLOW-38 | OK: actual defaults, switch and generated documentation numbers. |
| WFL-37 | FLOW-35 | Wrong: non-shell exclusion omitted from the short timeout; SR-RTM-15. Retry/second-hang reason otherwise represented. |
| WFL-38 | FLOW-36 | OK: bounded best-effort sends and logged control failures. |
| WFL-39 | FLOW-37 | OK: reset vs retained interrupt/open/finished state. |
| WFL-40 | FLOW-39 | OK: no automatic intervention on persistent teammates, allowed by D-27. |
| WFL-41 | FLOW-40 | Wrong for alternate run directory; ordinary termination/filter/rearm fixes are represented; SR-RTM-14. |
| WFL-42 | FLOW-41 | Wrong in integrations: current-run session tag attribution and runs-dir selection; SR-RTM-13/14. Journal-first totals retained. |
| WFL-43 | PHCL-20 | OK: own-run archive and runs-dir extension; adopted-agent integration needs SR-RTM-13. |
| WFL-44 | FLOW-45 | Wrong/partial: consent is present; restored A/B/C method/decision-tree behavior needs unchanged-method cross-trace after D-111; SR-RTM-05. |
| WFL-45 | FLOW-44 | Wrong: GSD-only recipe trimming is not permitted after D-111; SR-RTM-05. |
| WFL-46 | FLOW-44; gate delegated to M10 | OK: parallel-phase rule retained; bounded review gate is traced in method.md GSDF-46, not duplicated here. |
| WFL-47 | FLOW-30, FLOW-42 | OK: input-complete incident fixture and run-retention policy. |
| WFL-48 | Not a requirement: S-02 | OK: facade dropped with the single installed runtime. |
| WFL-49 | FLOW-43 | Wrong: extended host/engine responsibilities not reflected in the injected interface; SR-RTM-16. |
| WFL-50 | FLOW-44 | OK: per-item extracts/path guidance retained. |
| WFL-51 | PHCL-27, PHCL-36 | Wrong/partial: freeze represented, but report writing under enforced read-only has no supported route; SR-RTM-18. |
| WFL-52 | FLOW-01, FLOW-02, FLOW-16, FLOW-17, FLOW-25, PCLI-13, PCLI-14 | OK: BOM, console methods, journal existence, numbering policy, single archive and revised retry/permission rules represented. |
| WFL-53 | PCLI-11 | OK: creation tracking, dedup and late settlement. |
| HIS-01 | FLOW-30 | OK: complete-input timing and typed native calls. |
| HIS-02 | FLOW-31, FLOW-35 | Wrong in shell branch: redirected 400-second Bash can be interrupted; SR-RTM-15. Late-event guard retained. |
| HIS-03 | FLOW-35 | OK: waits for interrupted call's retry turn. |
| HIS-12 | PHCL-17, PHCL-18 | OK: one watcher, measured confirmation, no native autocompact override. |
| HIS-13 | PHCL-07 | OK: exact ordinary watch hints; detached custom-dir hint separately needs SR-RTM-14. |
| HIS-14 | FLOW-40 | OK: attach summary and opt-in replay. |
| HIS-15 | PCLI-13 | OK: five increasing delays and immediate nonretryable failure. |
| HIS-16 | FLOW-12, PCLI-16 | Wrong/partial: core session reuse represented but worktree, compatibility and adoption integrations incomplete; SR-RTM-11/12/13. |
| HIS-17 | PCLI-16 | OK: update/readback, active-turn/provider refusal and forgotten-agent fresh start. |
| HIS-18 | PHCL-14, FLOW-17, FLOW-22 | OK: price-based accounting/journal/logs, reported cost separate. |
| HIS-22 | PHCL-11 | OK: D-38 settles wait vs interrupt; batch follow-up guidance retained. |
| HIS-23 | FLOW-11, FLOW-02 | Wrong/partial: shell is adopted but interpreter/failure semantics and no-shell adapter boundary are unspecified; SR-RTM-03. |
| HIS-24 | PHCL-32 | Wrong: safe cleanup outcome is tied to an unsupported targeted prune command; SR-RTM-19. |
| HIS-28 | PHCL-33 | OK: caller-root refusal while retaining D-26 worktree support. |
| HIS-29 | PCLI-03 | OK: host/listen address, never pid discovery. |
| HIS-83 | FLOW-15 | OK for runtime principle: schema remains per-call cache input; adding another schema does not change unrelated keys. GSD result-schema design remains M10-owned. |
| HIS-89 | FLOW-14 | OK for rolling scheduling: no fixed batches. Capacity/progress composition defects separately SR-RTM-06/07. |
| UI-80 | PCLI-08 | OK: title policy, independent swarm label and parent label written last. |
