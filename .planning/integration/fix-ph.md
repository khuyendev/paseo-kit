# fix-ph: review CR-PHC (ph runtime and skill)

| Finding | Result | What changed or why |
|---|---|---|
| CR-PHC-01 | fixed | `runtime/cmd-agents.mjs` send: the pre-send wait result is checked; anything but `idle`/`error` (turn ended) fails that target with `turn still <status> after N s; not sent`, no delivery, no watch hint, exit 2. Same for the `--now` cancellation wait. Test `PHCL-11 a wait that times out refuses delivery, with and without --now (INV-55)` (fails on the old code). |
| CR-PHC-02 | fixed | `runtime/cmd-start.mjs` collect: each block tracks `admitted`; its `inFlight` reservation is released once on every post-admission exit; `liveCount` is released on a failed create unless the create error says the agent may still be live (`archived === false`, CR-FND-02 shape). Tests `PHCL-24 PHCL-10 collect: a failed create releases its admission ...` (stalled on the old code) and `... an archive failure keeps the agent counted live ...`. |
| CR-PHC-03 | fixed | `runtime/cmd-worktrees.mjs`: `allAgents()` reads every daemon page (`page.cursor`, `pageInfo.hasMore/nextCursor`; verified against the installed server's session.js); a failed page, a missing/repeated cursor or >1000 pages throws, so ownership stays unknown and spawned-agent worktrees are kept. Note text now `note daemon agent list unavailable (...)`. Tests: owner on a later page keeps its worktree; failed later page removes nothing. Shared `Session.listAgents/findAgents` pagination requested from the integrator. |
| CR-PHC-04 | fixed via request | Verified (test reproduces `installed GSD method file not in the inventory: .agents/agents/qa-inspector.md`). The defect is in `gsd/upstream.mjs` (GSC area; same as CR-GSC-08), so no code change here; test added as `{ todo }` in tests/ph/doctor.test.mjs, request filed to drop the todo when CR-GSC-08 lands. |
| CR-PHC-05 | fixed | `runtime/doctor.mjs` passes `--target ctx.root` to `gsd upstream check`. The doctor test now uses an installed GSD fixture (runtime + snapshot + every inventory file), asserts a bare project fails and a hand-edited generated file is reported. |
| CR-PHC-06 | fixed (one part via request) | doctor wraps every check (paseo, file mod, provider policy, adapter, gsd upstream, agent types) in a guard that emits `problem <check>: <error>` and continues; a gsd failure before its summary reports the error of gsd's JSON document (`gsd upstream check not run: ...`). With a broken overlay the upstream check is reported as not run (runGsd loads config strictly); a config-independent checker export was requested from the integrator. Tests: malformed project settings, malformed installed_plugins.json, broken overlay plus GSD install. |
| CR-PHC-07 | fixed | `runtime/agents.mjs` `flowList` tokenizes with quote/escape awareness: `,`, `]` and `#` are syntax only outside quotes. Test with include paths containing ` # `, `,`, `''` apostrophe, a plain item and a trailing comment, plus an escaped `\"`. |

Fixed 7 (CR-PHC-04 and the broken-overlay part of 06 complete once the integrator applies the requests), rejected 0.

## Tests

- `node --test tests/ph/*.test.mjs`: 75 tests, 74 pass, 0 fail, 1 todo (CR-PHC-04, waits for CR-GSC-08).
- `npm test`: 789 tests, 782 pass, 3 fail, 2 skipped, 2 todo. The 3 failures are outside this area and not caused by it (other fixers mid-change): CONF-02 lint flags `harness/adapter/mutex.mjs`; ADPT-10 lock takeover; GSDC-53 inventory coverage. An earlier run also failed the e2e tracer on `kit-newer .agents/harness/gsd/upstream.mjs` while the GSC fixer was editing it; that test passed on the last run.

## Requests filed (requests.md)

- integrator: paseo-client `listAgents`/`findAgents` exhaust pagination and fail on incomplete listings; then cmd-worktrees `allAgents()` goes back to `findAgents()`.
- integrator: `gsd/upstream.mjs` export a config-independent `checkTarget(target)` for doctor.
- integrator: drop `{ todo }` from the doctor project-owned-agent test after CR-GSC-08.
