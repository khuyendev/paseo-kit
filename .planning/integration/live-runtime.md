# Live acceptance: runtime — 2026-10-20

## Result

**9 pass, 1 fail, 0 blocked.** The failure is **live machine-policy readiness**, not an established kit implementation defect: installed doctor exits 2 because the existing worker provider does not disallow `SendMessage`. No policy was changed. Real agent lifecycle, cwd proof, workflow/schema, resume/cache, negative schema reporting, and two installed hook callbacks ran successfully.

| Status | Acceptance check | Independently inspected evidence |
| --- | --- | --- |
| PASS 1 | Minimal Git fixture; current kit installed without `--enable-plugin`; only overlay tiers configured | `external-git-init.json`, `external-install.json`; installed settings/overlay readback |
| PASS 2 | Installed doctor connects to REAL current daemon; requested models and medium effort resolve | `external-doctor.json`, `live-doctor.json`; cleanup snapshots confirm actual model/medium |
| **FAIL 1** | Clean doctor/machine-policy readiness | Both doctor calls exit 2: `problem agent provider circle-agent does not disallow SendMessage; run kit.mjs machine apply` |
| PASS 3 | Installed spawn/watch/result plus actual cwd and child-written nonce | `live-spawn.json`, `live-watch.json`, `live-result.json`; raw child transcript, independent nonce byte readback |
| PASS 4 | Installed send/watch/result delivers second turn in same agent | `live-send.json`, `live-watch-send.json`, `live-result-send.json`: exact `SEND_ACK_e84f05b9` |
| PASS 5 | Real `ph workflow`: schema agent + shell | Original journal has real agent `ok` and shell code 0; `result.json` contains validated object and fixture cwd |
| PASS 6 | Resume same logical run with cached agent and rerun shell | Resume journal `cached`, same key/agent/result, tokens 0; parent linkage; exactly two shell marker lines |
| PASS 7 | Real wrong-schema retries and failure reporting | Impossible-bounds probe: three real invalid replies, `null` reason in journal/log, exit 2, failed run.json, no result.json |
| PASS 8 | Installed io_guard in actual child host session | Exact transcript has PreToolUse:Grep and PostToolUse:Grep hook success, exit 0, rendered additional context |
| PASS 9 | Archive and cleanup | Installed `ph archive`; runner cleanup; public inspect independently confirms all five own agents archived; own local workspace archived |

**NOT-RUN / not claimed:** per-agent read-only Edit denial/advisory MC-03; full hook suite (context threshold/usage comparison, parallel round grouping, truncation, syntax checker, long heredoc rescue, p95 benchmark); watchdog timeouts; worktree isolation; minimum Node/POSIX qualification. These are not counted as passed or blocked.

## Roots, versions, launch arrangement

- Kit under test: `C:/Users/fish/Desktop/paseo-kit`, current final-review working tree; production remains read-only.
- Evidence/scripts root **E**: `C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/runtime/`.
- Authorized external fixture **F**: `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/runtime/fixture/`.
- Node **24.19.0**, Paseo CLI **0.11.2**, Claude Code **2.1.296**, Windows win32 x64. Host version is confirmed in actual transcript entries, not only the CLI version check.
- Overlay changes: only `tiers.frontier/pro/standard = {provider: "circle/gpt-6-astra[1m]", thinking: "medium"}`. No config defaults, machine keys, plugin selections, hooks, or installed runtime edits.
- Every model call actually ran **circle-agent/gpt-6-astra[1m], medium** (the kit's worker mapping for the authorized circle model). No other models used.
- To satisfy PHCL-33 rather than bypass it, public `paseo run --new-workspace local --cwd F` created an owned fixture orchestrator. Its daemon cwd was independently confirmed inside F. That agent ran the installed `ph` public CLI via the test driver; no spoofed caller IDs or altered root checks.
- Orchestrator was in default/Always Ask mode. Two exact owner-authorized test-command Bash requests were approved **once each** with `paseo permit allow <own-agent> <request-id>`; no persistent allow rules, modified input, mode changes, provider changes, or deny overrides. No actual tool-policy denial occurred. Installed ph children used its unchanged default `bypassPermissions` mode.
- Maximum concurrent owned agents: **2** (fixture orchestrator plus one test worker), below the requested cap of 3.

## Public commands actually exercised

Complete literal executable/argv/cwd/exit/stdout/stderr are retained in the named JSON records; prompts are retained too. All script writes use UTF-8. No direct runtime imports, fake daemons, mocked UI, or native Agent/Workflow/SendMessage were used.

Top-level invocations:

```text
node --version
paseo --version
paseo run --help
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/runtime/external-setup.mjs
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/runtime/ph-capture.mjs external-doctor doctor
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/runtime/bootstrap.mjs
```

`external-setup.mjs` executed `git init` in F, then:

```text
node C:/Users/fish/Desktop/paseo-kit/kit.mjs install C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/runtime/fixture
```

`bootstrap-command.json` retains the full public Paseo command including its prompt:

```text
node C:/Users/fish/AppData/Roaming/npm/node_modules/@getpaseo/cli/bin/paseo run --provider circle-agent/gpt-6-astra[1m] --thinking medium --title runtime-fixture-orchestrator-e84f05b9 --new-workspace local --cwd C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/runtime/fixture --env PASEO_HARNESS_ROOT=C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/runtime/fixture --wait-timeout 10m --json <literal prompt in bootstrap-command.json>
```

From the legitimate fixture agent, `node E/live-driver.mjs` launched these installed CLI commands (cwd F; absolute ph executable path in each raw record):

```text
node .agents/harness/ph.mjs doctor
node .agents/harness/ph.mjs spawn --name runtime-cwd-e84f05b9 --cwd F --model standard --effort medium --prompt <literal prompt in live-spawn.json>
node .agents/harness/ph.mjs watch runtime-cwd-e84f05b9
node .agents/harness/ph.mjs result --json runtime-cwd-e84f05b9
node .agents/harness/ph.mjs send --prompt "This is the second turn of the live send test. Do not use tools. Return exactly SEND_ACK_e84f05b9." runtime-cwd-e84f05b9
node .agents/harness/ph.mjs watch runtime-cwd-e84f05b9
node .agents/harness/ph.mjs result --json runtime-cwd-e84f05b9
node .agents/harness/ph.mjs archive runtime-cwd-e84f05b9
node .agents/harness/ph.mjs workflow --script E/probe.js --run-id wf_runtime_e84f05b9
node .agents/harness/ph.mjs workflow --resume wf_runtime_e84f05b9 --run-id wf_runtime_resume_e84f05b9
node .agents/harness/ph.mjs run-stats wf_runtime_e84f05b9 wf_runtime_resume_e84f05b9
node .agents/harness/ph.mjs workflow --script E/wrong-schema.js --run-id wf_runtime_negative_e84f05b9
node .agents/harness/ph.mjs archive --name-prefix runtime-cwd-e84f05b9
node .agents/harness/ph.mjs archive --run <each of the three above run IDs>
node .agents/harness/ph.mjs team
```

A follow-up to that same owned agent, retained as `followup-prompt.txt` and `bootstrap-followup.json`, ran:

```text
node E/ph-capture.mjs live-impossible workflow --script E/impossible-schema.js --run-id wf_runtime_impossible_e84f05b9
```

It then made one **real native Grep** call against `F/CLAUDE.md`, pattern `NONEXISTENT_RUNTIME_HOOK_e84f05b9`, `output_mode: content`, `head_limit: 5`. This produced the installed hook evidence below.

Waits were bounded CLI `ph watch` / `paseo wait --timeout 500` / `--timeout 180`, not external sleep/poll loops. Test subprocess timeouts were 60 or 180 seconds, with outer foreground command limits. Full one-shot permission and wait argv are in `bootstrap-one-shot-permission.json`, `bootstrap-wait.json`, `followup-one-shot-permission.json`, `followup-wait.json`.

## Independent artifact verification

### Child cwd and nonce

Worker `c0e7f6b1-1352-4ae6-9885-aac15ec8e6e8`, Claude session `f9334535-8ba0-4831-897c-58a0943e1b16`:

- Actual shell tool command `node -p 'process.cwd()'`, no cd/cwd override, returned `C:\Users\fish\Desktop\paseo-kit-live-tests-20261020\runtime\fixture`.
- An initial unquoted PowerShell expression had a parser error; it was corrected in the **same tool**, not rerouted after a permission denial.
- Permitted existing `mcp__fsbatch__write_multiple_files` wrote `F/child-cwd-nonce.txt`. This proves child writing, **not** the new harness-files mod; the latter remained unselected as required.
- Independent readback: exactly `child-cwd-e84f05b9-2a67\n`, hex `6368696c642d6377642d65383466303562392d326136370a`.
- Evidence: `child-nonce-inspection.json`, `independent-verification.json`, `transcript-inspection.json`, raw `transcript-f9334535-8ba0-4831-897c-58a0943e1b16.jsonl`. Success is not inferred solely from the agent's final reply.

### Workflow and resume

Authoritative directories: `F/_workspace/_runs/<run-id>/`, retaining scripts, args, run.json, journal.jsonl, log.txt and successful result.json files.

| Run | Result |
| --- | --- |
| `wf_runtime_e84f05b9` | done; started 1, ok 1, null 0, cached 0, output tokens 19; agent `78b8cf54-d88f-443d-b41e-9556f78609ef`; validated `{nonce:"workflow-e84f05b9",ok:true}`; shell code 0 |
| `wf_runtime_resume_e84f05b9` | done; parent original run; started 0, cached 1, tokens 0; same cache key/agent/result; returned logical runId still original |
| `wf_runtime_negative_e84f05b9` | Initial negative attempt **inconclusive**, not a product failure: model returned valid `EXPECTED` despite requested `WRONG`; no schema error was induced |
| `wf_runtime_impossible_e84f05b9` | failed **as expected**; session agent `556043d2-5f4c-4243-baae-803116bb803a` replied `{value:0}` three times against deliberately contradictory bounds; runner returned null; script surfaced it as failure |

`F/shell-executions.log` contains exactly two `shell-e84f05b9` lines: shell ran again on resume while the agent was cached. Independent readback is in `independent-verification.json`; stats output is `live-run-stats.json`.

Negative failure reason, present in BOTH journal and log:

```text
reply did not match the schema after 3 replies: #1 /value: must be >= 1; #2 /value: must be >= 1; #3 /value: must be >= 1
```

Negative CLI exit is 2, run.json status is failed, result.json is absent. Raw transcript `followup-transcript-e3da80b1-110d-409c-96c9-ff71c7f09334.jsonl` independently shows both retry prompts and all three invalid replies. No runtime safeguards were changed to induce this input-validation test.

### Installed live hooks

Orchestrator Claude session `37c36595-879a-4f73-b0ee-527677ba3a24` has actual `attachment.type: hook_success` entries naming:

- `PreToolUse:Grep`: installed `node "$CLAUDE_PROJECT_DIR/.claude/hooks/io_guard.mjs"`, exit 0, 74 ms, first-lookup reminder.
- `PostToolUse:Grep`: same installed hook, exit 0, 66 ms, empty-result reminder.
- Both have corresponding `hook_additional_context` entries rendered as system reminders for the same real Grep tool-use ID.

Evidence: `followup-transcript-inspection.json` and full raw `followup-transcript-37c36595-879a-4f73-b0ee-527677ba3a24.jsonl`. These two timings are **not a p95 benchmark**. No claim for other hooks follows from their absence in these short sessions. Only the exact newly created fixture transcript directory and its five known session files were inspected; no user's general transcript-directory scan.

## Preflight retained, now resolved

The first authorized location was `E/fixture`, inside the kit. `cli-test.mjs setup` initialized Git there, then installer exited 1: `failed: the project cannot be the kit itself`. `kit/install/index.mjs:41` intentionally rejects kit descendants. No bypass was attempted. Main subsequently authorized the external location F; installation there passed. Original `git-init.json`, `install.json`, `inspection.json` and the original fixture remain untouched. This historical location blocker is resolved and excluded from the final blocked count.

## Cleanup and remaining qualification

`cleanup-readback.json` independently captures public `paseo inspect --json` for **all five** owned agents, each `Archived: true`, correct parent, Astra model and medium effort:

- Fixture orchestrator: `208ba392-d495-4b1f-8c9e-e3011972601f` (parent tester `4914b18e-0f3f-40be-9500-5b46c8713795`).
- Cwd/send probe: `c0e7f6b1-1352-4ae6-9885-aac15ec8e6e8`.
- Positive workflow: `78b8cf54-d88f-443d-b41e-9556f78609ef`.
- Initial negative attempt: `4b0bb2c3-6135-4bbb-b78a-4e1f60be22a2`.
- Invalid-schema probe: `556043d2-5f4c-4243-baae-803116bb803a`.

Installed `ph archive` archived the orchestrator after its results were retained (`bootstrap-archive.json`). Public `paseo workspace archive wks_5f29802de39f11a9` archived only the newly owned local workspace (`workspace-archive.json`); local fixture files are preserved. `verify-cleanup.mjs` confirms archival, preserved fixture and absent negative result.json. No servers started; no commits or pushes; no unrelated agents touched; no production/specification edits; no owner settings writes or daemon reload/restart; no plugins enabled. Raw evidence, failed run and transcripts are preserved.

**Outstanding readiness issue:** doctor remains red for worker SendMessage deny-list drift. Only the owner may decide whether to change their live policy; this tester did not apply doctor's suggested machine change. Runtime/hook coverage is limited to the explicitly passed checks above, not full release qualification.
