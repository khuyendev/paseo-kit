# Code review: PHC — ph runtime and skill

## Verdict

REVISE; **3 BLOCKER, 4 MAJOR, 0 MINOR**. The scoped offline suite passed (`node --test --test-reporter=dot 'tests/ph/*.test.mjs'`, 66 tests), but it misses failure paths that interrupt a running worker, strand collection after a failed creation, and authorize pruning from an incomplete daemon listing. Doctor also misidentifies the installation being checked, rejects supported project agents through its new upstream-check integration, and stops early on broken plugin settings. Read-only, in-memory probes reproduced the send, collection, pagination, doctor-target, doctor-continuation and quoted-list failures below. No real daemon or owner configuration was contacted. All source and test files in the assigned paths were read in full, alongside the PHCL requirements, synthesis, decisions, interfaces, integration reports and runtime behavior map; the frozen old worktree implementation was consulted as reference.

## Findings

### CR-PHC-01 BLOCKER correctness A timed-out pre-send wait still delivers into a running turn
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/runtime/cmd-agents.mjs:24-28` (PHCL-11; INV-55).
- Evidence: `waitForFinish` returns a status object, including `timeout`; this command ignores it and unconditionally calls `sendPrompt`. A worker still running after `wait_timeout_s` therefore receives the follow-up without `--now`, defeating the between-turn delivery guarantee. A read-only stub returning `{status:'timeout'}` while `fetchAgent` continued to return `running` produced a send, `sent busy`, a watch hint and exit 0. The same issue applies when the cancellation wait for `--now` times out. `tests/ph/agents.test.mjs` checks that a wait call precedes delivery, but has no timeout assertion. The old map explicitly records the ignored status; preserving that implementation defect contradicts the current PHCL-11/INV-55 guarantee.
- Fix: inspect the wait result before delivering. Refuse a timeout or any state that does not establish the active turn ended, with a per-target failure and exit 2; do not print a hint for that target. Add ordinary-send and `--now` timeout tests asserting zero `sendAgentMessage` calls.

### CR-PHC-02 BLOCKER correctness Failed creation leaks an admission counter and strands collect
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/runtime/cmd-start.mjs:112-151` (PHCL-10, PHCL-24).
- Evidence: `admit()` increments both `liveCount` and `inFlight`. A creation failure decrements only `liveCount`; the `finally` decrements `inFlight` only when `agent` is non-null. Once later kept agents fill the live cap, pending blocks see a permanently positive `inFlight` and wait for a completion that cannot occur. Reproduced with both caps set to 1, three blocks and `--keep`: the first create fails; the second creates and finishes with a quota error; the third stalls with no active agent instead of reporting `live agent cap reached`. Successful completion of the second block produces the same counter state. An archive failure can also fill the cap without `--keep`. Existing tests cover creation failure and live-cap exhaustion separately, not their combination.
- Fix: track whether each block successfully reserved admission, separately from whether it obtained an agent. Release its `inFlight` reservation exactly once on every post-admission exit, including create/prompt failures; retain `liveCount` only for agents that actually remain live. Add a three-block failed-create/kept-agent regression and an archive-failure variant; both must terminate with exit 2 and named failures for remaining blocks.

### CR-PHC-03 BLOCKER correctness Pruning treats the first daemon page as a complete ownership census
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/runtime/cmd-worktrees.mjs:16-21`; dependency `ship/.agents/harness/paseo-client/index.mjs:170-172` (PHCL-32; fail-closed worktree ownership rule).
- Evidence: `agentLiveness` converts absence from `session.findAgents()` directly into `false`. That API calls `fetchAgents` once and discards `pageInfo`. The installed Paseo server's read-only source confirms a default page limit of 200 and a `pageInfo.nextCursor`/`hasMore` response (`@getpaseo/server/dist/server/server/session.js:4078-4097`). With a live owner on a later page, its currently clean, merged worktree becomes removable even though the owner is still working. The whole-daemon lookup makes this possible with modest numbers of agents per orchestrator. A fake two-page response confirmed one fetch and an omitted owner. The scoped worktree tests use unpaginated fake results.
- Fix: exhaust pagination in the shared Session listing API, including `listAgents`, before claiming completeness. If any page fails or the listing is incomplete, preserve unknown ownership and keep spawned-agent worktrees. Add a paginated worktree-prune test with the live owner on the second page and a later-page failure test; neither may issue a removal command.

### CR-PHC-04 MAJOR spec Doctor's upstream check rejects supported project-owned agents
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/runtime/doctor.mjs:109-113,141`; dependency `ship/.agents/harness/gsd/upstream.mjs:292-304` (PHCL-04, PHCL-26; D-109).
- Evidence: doctor now always runs the upstream integrity checker. That checker recursively examines every file under `.agents/agents` and reports every path absent from the GSD inventory as `installed GSD method file not in the inventory`. A correctly installed project adding `.agents/agents/qa-inspector.md`, including an adapter-generated replacement role, therefore fails doctor despite custom project agents being an explicit extension mechanism. No modification to a managed GSD file is necessary. The doctor test containing a custom `rev.md` does not catch this: the check actually targets `ship/` rather than that fixture (CR-PHC-05).
- Fix: distinguish project-owned role files from managed GSD artifacts in the integrity checker. Continue checking all inventory-owned generated files and detecting orphaned generated artifacts, but do not require arbitrary project agent definitions to enter the kit inventory. Add an installed-project doctor test with a valid custom adapter agent, then separately mutate a managed GSD agent and prove that mutation still fails.

### CR-PHC-05 MAJOR invariant Doctor certifies the runtime installation instead of the selected project
- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/harness/runtime/doctor.mjs:109`; `tests/ph/doctor.test.mjs:131-137`; dependency `ship/.agents/harness/gsd/upstream.mjs:365-367` (PHCL-04; GSDC-47; INV-36).
- Evidence: passing `root: ctx.root` to `runGsd` controls config loading, not the upstream target. Without `--target`, `upstreamVerb` uses `INSTALL_ROOT`, derived from its module URL. Invoking a runtime copy against another root, including the advertised `PASEO_HARNESS_ROOT` case, checks the wrong tree. A read-only probe with a nonexistent selected project still printed `ok gsd upstream check: 0 problems, 1 warnings; 211 references followed, 103 verbs mapped`. The new doctor test explicitly expects this OK line even though its temporary project contains no GSD installation, so it proves the accidental source-tree check rather than installed-project integrity.
- Fix: pass `--target ctx.root` explicitly, or expose a checker API whose target is required. Change the test to use an actual installed GSD fixture and assert that a missing or stale generated artifact under that root causes a problem even while the source `ship/` tree is intact.

### CR-PHC-06 MAJOR spec Doctor does not isolate failing diagnostic checks
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/runtime/doctor.mjs:52-53,109-113,138-145` (PHCL-04; CONF-08).
- Evidence: the unguarded `modLines` call reads native plugin settings through `filePluginState`. A malformed project `.claude/settings.json` or `installed_plugins.json` throws out of doctor, preventing provider-policy, adapter, GSD, agent-type and final checks and producing exit 1 instead of diagnostic exit 2. An in-memory malformed-settings probe reproduced the abort immediately after the overlay line. Separately, the new `runGsd` call strictly reloads the overlay: a broken overlay stops upstream checking despite doctor's promise to continue using defaults. Its structured error document is then discarded because only `problem:` and `check:` lines are recognized, leaving merely `problem gsd upstream check exit 1`.
- Fix: catch errors at each diagnostic boundary and emit a named `problem` while continuing. Invoke upstream integrity checking without a second strict config load, using the already resolved doctor context or a configuration-independent checker. Preserve the actual structured error if that checker fails before producing a textual summary. Add malformed settings, malformed plugin registry, and broken-overlay-plus-stale-GSD tests that assert later checks still execute and exit 2.

### CR-PHC-07 MAJOR spec Quoted flow-list values are corrupted before include loading
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/runtime/agents.mjs:44-46,94-101` (PHCL-26).
- Evidence: `flowList` strips comments on the complete list without tracking quotes, then splits on every comma. This violates the documented YAML subset's rule that comments start only outside quotes. A direct probe of `include: ["docs/a # b.md", "docs/c,d.md"]` returned `{"include":["docs/a"]}`. A valid include filename containing ` # ` is truncated and subsequent entries disappear; a comma inside a quoted filename splits it into two paths. Loading an otherwise valid role either fails with a misleading missing-file error or loads the wrong shorter path if it exists. The current quoted-comment test exercises only a scalar description, not a flow list.
- Fix: tokenize flow lists with quote/escape awareness, treating commas and comment markers as syntax only outside quotes; preserve each quoted value intact. Add flow-list include fixtures containing spaces, ` # `, commas and quoted apostrophes, plus a trailing real comment, and assert the exact included paths and bodies.
