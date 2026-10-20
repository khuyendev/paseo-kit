# Live UI acceptance — 2026-10-20

## Result

**23 pass, 0 product fail, 0 blocked scenario groups** after the authorized populated-swarm follow-up (initial smoke: 16 pass, 1 blocked; that blocker is now resolved). This is a bounded smoke, not full PANL qualification. Actual isolated Paseo daemon and its bundled web client were exercised; no fake renderer, mocked daemon, plugin-handler imports, or agent-final-text assertions.

- Initial server smoke: **12 pass** (two live installations plus ten RPC checks).
- Initial visual smoke: **4 pass** (planning board, plan detail navigation, file reader navigation, empty swarm surface).
- Populated follow-up: **7 additional pass**, enumerated below; **0 blocked** after authorized inherited authentication succeeded.
- Not-run scenarios are listed below separately and are not included as passes.

## Environment and isolation

- Windows 11, Node **24.19.0**, installed Paseo CLI/server **0.11.2**.
- Existing Playwright Core **1.58.2**, read-only import from `C:/Users/fish/Desktop/paseo/node_modules/playwright-core/index.mjs`; installed Chromium revision directory `C:/Users/fish/AppData/Local/ms-playwright/chromium-1208`. No package/browser install.
- Kit source: `C:/Users/fish/Desktop/paseo-kit`; both production plugins used unchanged as directory sources.
- Evidence/scripts root (`E` below): `C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/ui`.
- Isolated Paseo home: `E/home`; isolated `CLAUDE_CONFIG_DIR=E/claude`, HOME/USERPROFILE=`E/user`. Existing inherited PASEO_/CLAUDE_/ANTHROPIC_/OPENAI_ variables removed in CLI/host wrappers; no credentials copied.
- Fixture: `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/ui/fixture`, created after main's location correction. Workspace `wks_7d5e8c13c1a10469` (`live-ui-fixture`). No kit installer was needed for this read-only planning fixture.
- Bound exclusively to **127.0.0.1:19473**, relay disabled. Initial isolated host had web UI disabled; enabled only that home's `features.webUi.enabled`, then restarted only that isolated daemon. Owner daemon/settings never changed.
- Initial smoke created no agents. Follow-up created exactly two real `claude/gpt-6-astra[1m]` agents at medium effort using the isolated default Claude provider, as explicitly authorized by main (not the owner's circle config). No commits, push, production-source edits, or specification changes.
- Host's default speech subsystem started background model downloads into the isolated home (see `host.log`); preserved, not used by these tests. No downloaded source was executed by test scripts.

## Exact commands and raw records

Every CLI invocation, timestamp, stdout/stderr and exit status is retained in **`E/commands.jsonl`**. The `E/cli.mjs` wrapper executes installed `@getpaseo/cli/dist/index.js` with isolated environment and a 45-second timeout, cwd at the kit. Thus these are the actual public CLI, not in-process implementation tests.

Commands (expand E to the evidence root above):

```text
node E/cli.mjs --version
node E/cli.mjs daemon run --help
node E/cli.mjs plugin install --help
node E/host.mjs
node E/cli.mjs plugin install C:/Users/fish/Desktop/paseo-kit/plugins/planning-panel --home E/home --json
node E/cli.mjs plugin install C:/Users/fish/Desktop/paseo-kit/plugins/swarm-map --home E/home --json
node E/cli.mjs workspace create --help
node E/cli.mjs daemon config --help
node E/cli.mjs workspace create --isolation local --path C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/ui/fixture --title live-ui-fixture --home E/home --json
node E/cli.mjs daemon config set features.webUi.enabled true --home E/home
node E/cli.mjs reload --home E/home --json
node E/cli.mjs plugin ls --home E/home --json
node E/rpc.mjs
node E/cli.mjs daemon restart --home E/home --json
node E/browser.mjs
node E/browser.mjs > E/browser-final.log 2>&1
node E/cli.mjs plugin logs planning-panel --home E/home --json
node E/cli.mjs plugin logs swarm-map --home E/home --json
node E/cli.mjs daemon stop --home E/home --json
node E/cli.mjs daemon status --home E/home --json
```

`host.mjs` launched the installed CLI `daemon run --home E/home` with a ten-minute maximum lifetime; exact launch argv/PID in `host-process.json`, daemon output in `host.log`. `rpc.mjs` uses the installed real daemon client over the host connection, calling `invokePluginRpc`; it never imports plugin implementation. `rpc.json` records each request, unmodified response and elapsed milliseconds, independently read after execution. `browser.mjs` drives the actual bundled Paseo web UI with Playwright and asserts rendered text; `browser-final.log`, `browser-errors.json` (empty), and text/screenshot artifacts retain the results.

Preflight: an initial tool batch was interrupted by main's fixture-location correction before installing plugins. Partial state was reread; no duplicated host started. The fixture moved outside the kit; the already-isolated host home remained under the originally authorized E path.

## Passed checks

| # | Live check | Observed result / evidence |
|---|---|---|
| 1–2 | Install planning-panel and swarm-map; list installed plugins | Both `running`; subsequent logs show `Plugin ready` (PANL-01 server boundary). `commands.jsonl`, `host.log`. |
| 3 | `planning.index` before seeding | Typed `no_planning`, resolved external workspace directory. |
| 4 | `planning.index` after seeding seven files | `ok:true`, complete scope, seven entries, phase `IN_PROGRESS`. |
| 5 | `planning.board` | Four wave-1 plans, two complete summaries, 2/4 and 50%; six ladder columns retained. |
| 6 | `planning.plan` 01-01 | Objective, Task 1, nested must-haves, completed summary and created file preserved. |
| 7 | `planning.file` PROJECT.md | Correct Markdown body, workspace/path identity, not truncated. |
| 8–9 | Traversal and absolute-path requests | `../outside.md` and `C:/Windows/win.ini` both return typed `not_found`; no content returned. |
| 10 | First `swarm.snapshot` | Actual empty daemon: `ok:true`, empty brains/files/events, no errors, epoch and cursor. |
| 11 | Next `swarm.snapshot` with returned cursor/epoch | Empty new events, same epoch. |
| 12 | `swarm.agent-detail` unknown id | Typed `not_found`, directory null. |
| 13 | Click actual Planning sidebar surface | Stats/board visibly show 2/4, 50%, one in-progress phase. `planning.png`. |
| 14 | Click Phases then Open plan 01-01 | Actual split pane: objective, task, must-have, summary, no invented task percentage. `plan-detail.png`. |
| 15 | Click Files then PROJECT.md | Actual tree/Markdown reader shows fixture heading and body. `file-reader.png`. |
| 16 | Click Swarm sidebar surface | Live 0 brains/0 swarms, empty-state hint, counters, legend, inspector hint. `swarm.png`. |

RPC times in order: **8.6, 59.5, 3.2, 4.0, 2.1, 1.1, 0.9, 7.0, 1.3, 2.8 ms**. Empty-swarm first/steady calls were 7.0/1.3 ms; these do not qualify populated/100-agent performance or caching internals.

### Screenshots independently viewed

All are actual browser renders, not generated pictures:
- `_workspace/live-acceptance/ui/planning.png`
- `_workspace/live-acceptance/ui/plan-detail.png`
- `_workspace/live-acceptance/ui/file-reader.png`
- `_workspace/live-acceptance/ui/swarm.png`

All four were opened with the image-reading tool and visually inspected. Text artifacts: `planning-text.txt`, `plan-detail-text.txt`, `file-reader-text.txt`, `swarm-text.txt`. `initial.png` is the genuine startup splash and **not** a passing visual screenshot; `mounted.png` is host shell mount.

Harness-only exploratory failures: first screenshot was taken before mount; initial planning wait incorrectly expected the PROJECT heading on Roadmap; generic `Phases`/`Files` text matched both tabs and tiles, and React Native Press lacks button role. Corrected test selectors to actual accessibility labels and board text, without altering production code. Final complete browser run succeeded and `browser-errors.json` is `[]`. Those selector mistakes are not counted as product failures or blocked tests.

## Blocked / not run / remaining qualification

**Original blocker resolved:** main authorized inheriting existing endpoint/auth variables in test-process memory. The isolated default Claude provider successfully ran two Astra agents; no endpoint or credential literals were written to provider config or test evidence. No fake timeline or owner-daemon workaround.

**Still not run:** permission/error states, context above threshold, ghosts/NEW timing, handoffs/write conflicts, orphan brain, harness-files batch tool classification, full PANL-10 smoke/icon inventory, populated scale. These are unverified scenarios, not current environment blockers. Native Read/Write, successful detail/ledger, linked 2/4 hub, lifecycle feed, and running-to-idle counters were exercised in the follow-up.

**Not run:** reconnect with a continuously mounted client across daemon outage (the restart preceded browser mounting); plugin reload duplicate-event test; desktop/Electron client; compact/theme variants; workspace panel and command-center Open Planning entry; workspace switching/stale response races; nested-link Back/Close and clipboard actions; file filter/expand-collapse; symlink escape; 5,001-file/truncated/unreadable fixtures; malformed frontmatter; full ladder parity against ph; PATH-without-node; live 100-agent scale/animation budgets; all remaining PANL cases beyond the bounded checks above. No claim of full PANL completion.

## Authorized populated-swarm follow-up

Main explicitly authorized inherited endpoint/auth environment on the same isolated host, with at most two Astra agents. Read installed `protocol/dist/provider-config.js`, server `persisted-config.js`, `agent/provider-launch-config.js`, and Claude options before configuring. The provider schema allows `agents.providers.claude.command`, `models`, and model `thinkingOptions`; provider environment inherits the daemon environment. Added only the absolute installed Claude executable path and `gpt-6-astra[1m]`/medium metadata to the isolated home. No owner provider/config was copied.

`host-populated.mjs` retains inherited ANTHROPIC endpoint/auth only in process memory, clears parent Claude/Paseo session variables, and preserves the original isolated HOME/USERPROFILE, CLAUDE_CONFIG_DIR, PASEO_HOME and loopback port. The wrapper redacts inherited credential/endpoint values from captured output. `host-populated-process.json` records only presence booleans, not values. Source plugins remained unchanged.

Exact additional commands:

```text
node E/cli.mjs run --help
node E/host-populated.mjs
node E/populated.mjs
node E/audit-populated.mjs
node E/cli.mjs daemon stop --home E/home --json
node E/cli.mjs daemon status --home E/home --json
```

`populated.mjs` creates through the actual installed client/host boundary, with 120-second parent and 150-second child waits, and always archives its own IDs in finally. The harness-level job had a six-minute limit. No retries or additional agents were used.

- Parent: `8e1b2b85-884c-4416-bcf2-b017bbf60dd2`, title `live-ui parent`.
- Child: `0a1967be-bbe9-4719-b981-3fbb6e385a33`, title `live-ui child`; `callerAgentId` and actual `paseo.parent-agent-id` point to the parent; `ph.swarm=live-ui`, `harness.run=live_ui`.
- Runtime readback: provider `claude`, model and runtime model `gpt-6-astra[1m]`, effective thinking `medium`, mode `bypassPermissions`.
- Harmless input/output: external fixture `ui-input.txt`, `ui-output.txt`.
- Hand-authored **planning-link fixture only**: `_workspace/_runs/live_ui/{run,args}.json` names `.planning/phases/01-live`, wave 1. This tests read-only UI linking, **not** actual workflow execution.

| # | Additional check | Independently inspected evidence |
|---|---|---|
| 17 | Real Astra parent and child finish | Runtime model/effort readbacks and real user/assistant timeline; parent and child finish idle. |
| 18 | Child native file work | Actual completed Read(input) and Write(output) in `populated-child-timeline.json`; independently read output equals `UI_CHILD_WROTE blue sparrow 20261020` plus newline. |
| 19 | Snapshot parent/swarm grouping | One brain, group `live-ui`, actual child ID/parent label, no snapshot errors. |
| 20 | Detail and file ledger | Success detail includes prompt/reply and native file activities; snapshot and inspector show read input/write output holds. |
| 21 | Linked wave | RPC asserts 2 done / 4 total; actual rendered hub half-ring and `phase 01 wave 1 · 2/4 plans`. |
| 22 | Populated inspector | Clicked child node in actual client; screenshot shows model/medium/mode, context 12k/1M, last prompt/reply, held files, recent actions. |
| 23 | Running-to-idle/lifecycle feed | Same mounted client changes from 1 running/1 sleep to 0 running/2 sleep, with spawn, got prompt, Read, Write and report rows. No reload. |

Raw evidence under E: `populated-launch-metadata.json`, `populated-owned.json`, `populated-results.json`, `populated-child-timeline.json`, `populated-audit.json`, `host-populated.log`, `swarm-populated-text.txt`, `swarm-child-detail-text.txt`, `populated-browser-errors.json` (empty). `audit-populated.mjs` independently checked the actual timeline's completed Read and Write, final snapshot/errors/wave counts, both archived timestamps, and post-archive empty swarm.

Additional actual screenshots, both opened and independently viewed:
- `_workspace/live-acceptance/ui/swarm-populated.png`: initial running header/feed; capture lands during boot fade, so nodes are faint. **Not evidence of settled running-read glyph quality.**
- `_workspace/live-acceptance/ui/swarm-child-detail.png`: settled populated map and selected child inspector; half-progress hub clearly visible.

The child did not perform the prompt's requested final reread of its output (timeline has one Read and one Write). We do not claim that extra model action occurred: the tester independently read and validated the file, and native read/write requirements of this scenario were met. No inference of file success from `UI_CHILD_DONE` alone.

Follow-up cleanup: archive RPCs succeeded for only those two IDs; independent refresh confirmed non-null archivedAt for both and `swarm.snapshot` returned no brains. Stopped only supervisor **2084**, `forced:false`, lifecycle RPC used; final isolated status **stopped**, pid/listen null. Both background jobs completed exit 0. Browser closed. Home, runtime logs and fixtures preserved.

## Initial cleanup (before follow-up)

`daemon stop --home E/home --json` returned `action:stopped`, `forced:false`, `usedLifecycleRpc:true`, supervisor PID 13104. Subsequent status returned **`localDaemon: stopped`, pid/listen null**. Host wrapper background job completed with exit 0. Playwright browser closed in `finally` on every attempt. No agents to archive. Isolated home, workspace registry, fixture, logs and screenshots deliberately preserved; no destructive cleanup. Owner's daemon, provider/plugin selections and real projects untouched.
