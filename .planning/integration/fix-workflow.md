# fix-workflow: review CR-WFL (code-workflow.md)

| Finding | Result | What changed or why rejected |
|---|---|---|
| CR-WFL-01 | fixed | `cmd-workflow.mjs`: `--run-id` and `--resume` ids must be one path segment and not only dots (`.`/`..`/`...` refused, exit 1). An existing run dir is refused in `prepare` (exit 1, nothing touched), and `writeRunStart` claims the dir with a non-recursive `mkdir` (EEXIST -> exit 1), so concurrent starts with one id cannot both write. Resume onto its own id is refused the same way. The detached child is the only reuse: the parent passes `PASEO_HARNESS_CLAIMED_RUN_DIR` = its run dir, and the child accepts it only when run.json is `running`, has the same runId and the pid of the parent or of itself (a worker inheriting the variable matches neither). Tests: `FLOW-19 dot-only ids...`, `FLOW-18 FLOW-19 an existing run id is refused...` (bytes unchanged, self-resume), `FLOW-19 two concurrent starts...`, `FLOW-21 only the detached child named by its parent's claim...`. |
| CR-WFL-02 | fixed | `engine.mjs`: calls with the same session key are serialized (`inSession`, a per-key promise tail) from the cache/adoption step through admission, runner and finish; the run semaphore is taken inside, so no deadlock. The host then sees the session already established for the second call (one agent, failure cleanup only touches its own call). Tests: `FLOW-12 FLOW-47 parallel calls with one session key run one after another` (engine) and `FLOW-12 FLOW-47 two parallel first calls of one session make one agent...` (real host + fake daemon: 1 create, 1 send, all archived). |
| CR-WFL-03 | fixed | `watchdog.mjs`: on the first stuck interrupt every open call with complete input is closed into `toolSpans` at the interrupt time and its id added to `finished`, then the map is cleared; `promptAt` and the stuck flag are kept. Test: `FLOW-29 FLOW-35 an interrupted long shell call stays tool time` (950 s model + 900 s Bash with stop 1800 s: 960 s model time, no stop/archive, late completed event ignored). |
| CR-WFL-04 | fixed | `engine.mjs`: budget and cap are checked again after a successful `host.admit`, with no await before `state.started++`; a throw releases admission/semaphore in `finally` and writes no start record. Tests: `FLOW-43 FLOW-09 maxAgents below maxConcurrent...` (4 parallel, cap 1 -> 1 runner call), `FLOW-09 FLOW-14 spend that grows while a call waits for admission...`. |
| CR-WFL-05 | fixed | `runner.mjs`: passes the absolute `deadline` to `Session.waitTurn` (the foundation fixer added that option in paseo-client: retry pauses and continue prompts past it become a timeout, CR-FND-03); after every reply the runner checks the deadline again, a timeout is always reported as `no reply within <timeoutS> s`, and `send()` refuses a schema/priming follow-up prompt after expiry. Test: `FLOW-04 timeoutS bounds the whole call across provider retries` (overload then success with timeoutS 5 -> null, reason kept, agent archived, no timer left). Gap: warm-up gate wait and agent creation are not cut by the deadline; the next wait fails at once if it has passed. |
| CR-WFL-06 | fixed | `runner.mjs`: the serializable `worktree` object is in every isolated call's result, not only session calls, so the engine journals it and cache hits return it; session adoption stays keyed on `session`. Test: `FLOW-15 FLOW-27 a non-session isolated detail call keeps its worktree path through two resume generations` (1 create, 1 worktree, same detailed result in wf_2 and wf_3). |

Fixed 6, rejected 0.

## Tests

- `node --test tests/workflow/*.test.mjs`: 113/113 pass (102 before + 11 new).
- `npm test`: 774 tests, 771 pass, 0 fail (the other 3: 2 skipped, 1 todo, none in tests/workflow).

## Requests filed

None. CR-WFL-05 needed a deadline in `Session.waitTurn`; the foundation fixer had already added it (`deadline` option), so the runner uses it directly.
