# fix-foundation: code-foundation.md (FND)

| Finding ID | Outcome | What changed or why |
| --- | --- | --- |
| CR-FND-01 | fixed | Verified the original unsafe cmd renderer in the diff. Preserved the prior fix: `cmdShim` uses explicit `cmd.exe /d /v:off /s /c` with verbatim arguments, rejects %, CR, LF and NUL before launch, and quotes other argument data. `runArgv` and `runClaude` share it. Windows round-trip tests cover !NAME!, embedded quotes (also combined with shell operators), trailing backslashes, spaces, empty arguments and shell metacharacters. Expansion and newline marker probes are refused without launching. |
| CR-FND-02 | fixed (FND side; integration still required) | Verified the original swallowed archive failure and the callers' unsafe worktree removal. Preserved structured `agentId` and `archived`; strengthened confirmation to an explicit boolean rather than archive-error truthiness, and preserved `cause` and `archiveError`. Tests cover confirmed archive, subscription plus archive failure with a still-live agent, and archive rejection with no error value. Runtime/workflow worktree and capacity fixes belong to the integrator and remain requested, not claimed complete. |
| CR-FND-03 | fixed (FND side) | Preserved explicit absolute `deadline` support and capped waits/backoff admission. Four new regressions failed against the prior fix: oversleep sent a continuation after expiry, late waits/reply resolution returned success, late-usage settling exceeded the deadline, and multiple permission responses continued past expiry. Fixed all four: recheck after sleep, after wait, after usage settling and reply resolution, before each permission response; cap late-usage polling to the deadline while preserving exactly-once snapshot accounting. Without an explicit deadline, existing per-wait timeout and five-retry semantics remain unchanged. The workflow fixer has supplied deadline pass-through and post-reply expiry checks in runner.mjs. |

## Files changed (including resumed edits)

- `ship/.agents/harness/lib/proc.mjs`
- `ship/.agents/harness/platform.mjs`
- `ship/.agents/harness/paseo-client/index.mjs`
- `ship/.agents/harness/paseo-client/usage.mjs`
- `tests/foundation/platform-lib.test.mjs`
- `tests/foundation/paseo-turns.test.mjs`
- `.planning/integration/requests.md`
- This report.

## Tests run

- Initial foundation baseline after the prior fixer: 71/71 passed on Windows (the previous mutex lint failure is gone).
- New deadline regressions before fixing: 11 passed / 15 total, 4 failed, confirming the unfinished cases above.
- Final `node --test tests/foundation/*.test.mjs`: **76/76 passed**, zero failures/skips/todos; native Windows shim tests executed.
- `node --test tests/gsd-flows/execute.test.mjs`: **12/12 passed**, used to diagnose transient concurrent flow edits.
- Final `npm test`: **837 passed / 843 total**, **0 failures**, **2 skipped**, **4 TODO**, exit 0. The reported failing TODO is the existing INST-04 invalid-UTF-8 byte digest test (`tests/install/units.test.mjs:61`, CR-INS-05), already assigned to the integrator by fix-install. Earlier full-suite runs during concurrent flow edits had 13 GSDF failures; all disappeared on the final run without altering those files.
- No daemon, real project, user configuration, live model or agent was used. No commit made.

## Requests filed

Existing requests preserved, plus one follow-up documenting the completed error/deadline shape:

1. `runtime/start.mjs`: retain worktree and branch when creation error carries an agent identity and unconfirmed archive; report identity. Add regression for subscription plus archive failure.
2. `workflow/runner.mjs`: adopt the identity from a failed post-creation setup, preserve worktree and capacity bookkeeping until cleanup is confirmed, including regression coverage. This remains outstanding in the source inspected.
3. `workflow/runner.mjs`: pass absolute deadline and reject late success. Implemented by fix-workflow in the source inspected; original request also asks that timeout diagnostics consistently name the whole-call allowance.
4. `docs/INTERFACES.md`: document cmdShim, deadline, structured creation errors (including cause/archiveError), and deadline-capped UsageTracker settling. Documentation is outside this fixer's assigned paths.

## Remaining limits

- CR-FND-02 is not end-to-end safe until the integrator applies the caller changes above. FND tests prove accurate cleanup outcome and retained identity, not caller worktree/capacity behavior.
- Batch scripts containing their own delayed expansion or arbitrary argument re-evaluation are trusted executable code; the shim transport tests use a normal `%*` forwarding script. Percent/newline/NUL arguments deliberately fail closed rather than being silently rewritten.
- Deadline checks bound retry decisions and prevent accepting late results; an in-flight daemon RPC still relies on that client's own completion/timeout behavior rather than being cancellable here.
