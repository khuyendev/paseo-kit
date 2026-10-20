# Worker SendMessage readiness fix — 2026-10-20

Owner authorized fixing the remaining live findings after the test-only pass.

## Change

Added exactly `SendMessage` to existing `agents.providers.circle-agent.disallowedTools`. The existing main provider `circle.disallowedTools` remains `["Agent", "Workflow"]`; SendMessage stays allowed there. No models, endpoints, credentials, env, plugin/skill/tool selections or unrelated provider rules changed.

The public `paseo daemon config get/set` interface does not accept individual dynamic provider paths; probing get returned "Unknown configuration path" with no write. Instead the one-shot local script `_workspace/live-fix/worker-policy.mjs` used the kit's pure additive `patchProviders` function narrowed to this single rule, asserted the proposed entire JSON equals the original with only that array addition, then changed only the deny-list array span in the original file text. It checked for concurrent changes, created an exclusive backup alongside the live config, staged a file, atomically renamed, and reread/asserted the result. No secrets were emitted or copied into repository evidence.

Backup path and nonsecret verification: [worker-policy-fix.json](worker-policy-fix.json). Backup remains in the owner's `.paseo` directory, not git.

## Verification

- `paseo reload --home <existing home> --json`: exit 0; no daemon restart.
- Installed public `node .agents/harness/ph.mjs doctor` in the preserved external runtime test fixture: **exit 0**.
- Doctor: worker has all **18 required rules**, **34 owner-extra rules preserved**, kit env present.
- Doctor: main provider denies only the required Agent/Workflow orchestration primitives; direct config assertion confirms main SendMessage was not added.
- Unrelated live config JSON identical to the pre-change value; original file text outside the worker deny-list span preserved.
- The old readiness failure in live-runtime.md / LA-03 is resolved; that historical test report is retained rather than rewritten.

Provider reload makes the policy available to new sessions. A fresh-worker tool-surface check is included in the independent adapter requalification; no claim is made that already-running agent tool registries hot-reloaded.
