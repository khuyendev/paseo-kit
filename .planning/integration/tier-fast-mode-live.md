# Tier native Fast live qualification — 2026-10-20

**Result: 7 pass, 1 fail, 2 blocked; effective-on unverified.**

The existing tier-to-daemon toggle path works. This run does **not** qualify effective native Fast ON: both actual Opus responses reported `usage.speed: "standard"`, including the ON child. Neither accessible runtime metadata nor the scoped retained diagnostics exposed a Claude Code effective `fastMode` flag. Do not describe this as Fast successfully turning on or upstream honoring `speed:fast`.

## Checks

| Check | Result | Evidence |
| --- | --- | --- |
| Actual provider feature discovery | PASS | `listProviderFeatures` returned supported `fast_mode` toggle, label Fast, for circle-agent/claude-opus-5-5[1m] |
| Fresh external fixture, current install, no plugin activation | PASS | Fresh-directory creation, git init and install exit 0; install log |
| Legitimate public parent and actual cwd | PASS | Public `paseo run --new-workspace local`; driver process cwd and daemon parent cwd match fixture |
| Public installed `ph spawn --model pro`, ON readback and reply | PASS | Fresh child; requested/persisted/readback fast_mode true; exact acknowledgement |
| Only tier Fast changes, fresh OFF readback and reply | PASS | Deep comparison of overlays; false readback; same requested/effective model, medium effort, bypassPermissions, cwd and parent |
| Attempt bound and serial execution | PASS | Exactly two target calls, one completed turn each, no tools or retry; OFF starts after ON reply/artifact persistence |
| Scoped cleanup and preservation | PASS | Both children and parent archived, exact local workspace archived, fixture/git/logs preserved |
| ON backend response reports Fast speed | FAIL | ON native assistant usage reports `speed: "standard"`, not `fast`; OFF also standard |
| Claude Code effective fastMode ON application | BLOCKED | Daemon feature readback is true but native effective flag not exposed in captured runtime/transcript/diagnostics |
| Claude Code effective fastMode OFF application | BLOCKED | Daemon feature readback is false and response standard, but native effective flag not exposed |

## Invocation and identities

Fixture: `C:/Users/fish/Desktop/paseo-kit-fast-mode-test-20261020/` (creation fails if preexisting).

Scripts and detailed nonsecret evidence: `_workspace/tier-fast-mode-test/`.
Compact evidence: `.planning/integration/tier-fast-mode-evidence.json`.

Parent: `78fe6d6a-bdb3-497a-91f6-aede2dde4aa0`; workspace: `wks_1a9040fdc5ad5f32`.
Parent uses `circle-agent/gpt-6-astra[1m]`, medium, default permission mode. Its one foreground PowerShell request was inspected and approved once with unchanged input; no persistent rule was installed and no denial was bypassed.

Launch uses `paseo run --new-workspace local --cwd <fixture> --provider circle-agent/gpt-6-astra[1m] --thinking medium --env PASEO_HARNESS_ROOT=<fixture>`; full nonsecret argv retained in `launch-command.json`.

Both target commands use installed `ph spawn --name <name> --model pro --prompt "Reply exactly FAST_TOGGLE_ACK. Do not use tools."`. No concrete-model argument, explicit effort override, fast override, alternate fast-named model, fallback cwd or caller spoofing. Kit runtime notes are appended by normal ph behavior (names differ); the user task prompt is identical.

| Field | ON | OFF |
| --- | --- | --- |
| Agent | `6f9d6b0c-0d79-45fb-9111-6485545a42e6` | `431458cc-81ab-4b8f-b2d7-2cecfcc1d87c` |
| Native session | `dca6ce47-a866-4074-814a-703de0b20100` | `a0ee0743-2382-4eb3-abba-8ff9d134fa35` |
| Requested model | claude-opus-5-5[1m] | same |
| Native response model | claude-opus-5-5 | same |
| Runtime model | claude-opus-5-5[1m] | same |
| Requested/effective/native effort | medium | medium |
| Effective/native permission mode | bypassPermissions | bypassPermissions |
| Daemon Fast readback | true | false |
| Native usage.speed | standard | standard |
| Reply | FAST_TOGGLE_ACK | FAST_TOGGLE_ACK |
| Input / cache creation / cache read / output tokens | 2 / 19526 / 0 / 16 | 2 / 7028 / 12498 / 16 |
| Daemon reported cost USD | 0.097958 | 0.037967600000000004 |

Two paid target inference attempts, total reported target cost **$0.1359256**; the Astra parent is additional orchestration inference and excluded from that target total. Reported cost is not an invoice or proof of Fast billing. Cache differences prevent meaningful cost comparisons; these tiny calls are not a latency benchmark. No quota/auth/billing failure occurred and no safeguard was disabled.

## Exact evidence boundary

- API shape verified from installed `@getpaseo/client/dist/daemon-client.d.ts:1083` and `@getpaseo/protocol/dist/messages.js:2422-2433`: draft includes provider, cwd, optional model/modeId/thinkingOptionId/featureValues. `capability.json` retains the real response (not just model catalogue inference).
- Source: `ship/.agents/harness/runtime/models.mjs:19-48` resolves a tier's thinking and features; `ship/.agents/harness/paseo-client/index.mjs:61-85` forwards features as `featureValues`. The installed public ph skill was read; its tier Fast guidance is at lines 67-72.
- Installed provider source under `C:/Users/fish/AppData/Roaming/npm/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/server/agent/providers/claude/agent.js:2764-2785` builds SDK settings `{fastMode}` from the feature; lines 268-308 summarize the flag and line 2576 emits the debug `claude query` record. This establishes intended implementation, **not proof of actual flag application in these two sessions**.
- `initial-on.json`, `initial-off.json`, `finished-on.json`, `finished-off.json` contain selected live daemon fields and the small own timelines. `comparisons-cleanup.json` retains explicit readback comparisons plus selected requested/persisted config fields from the two owned `.paseo/agents/C-Users-fish-Desktop-paseo-kit-fast-mode-test-20261020/<agent>.json` files. The archived readback supplies `effectiveThinkingOptionId` and `currentModeId`; feature values were captured before archive.
- Native host transcripts: `C:/Users/fish/.claude-circle/projects/C--Users-fish-Desktop-paseo-kit-fast-mode-test-20261020/<native-session>.jsonl`, **line 3** for native permission/cwd, **line 18** for requested/response model, medium effort, Claude Code version 2.1.296 and full usage including speed. Selected fields retained in `host-evidence.json`; no full system prompts, headers, credential/environment values or endpoints copied.
- Scoped own-agent debug extraction from existing `.paseo` root log files found no `claude query` records for these children. No logging settings were changed, and no daemon reload/restart was performed. Native transcript inspection found usage.speed but no explicit effective fastMode field. The precise cause of standard-speed ON remains unproven (client application, service eligibility or upstream handling cannot be separated by this evidence).

No product source, specifications, kit defaults or owner configuration were edited. No commits, native subagents, broad archive commands, additional target attempts, credentials copied or messages to main. Fixture overlay ends with only pro Fast false; other tier/settings values are preserved. Qualification remains incomplete despite correct tier feature transport.

## Follow-up: native CLI request-formation control

Main ran six direct Claude Code 2.1.296 invocations (Haiku 5.5, Sonnet 5.5 and Opus 5.5, each with Fast off/on)
against a loopback endpoint. All replies were synthetic; no upstream inference occurred. The control observed
outbound request bodies, not model-reported state: all OFF requests omitted speed; ON emitted `speed:fast` only
for Opus in these invocations. Haiku/Sonnet ON requests omitted speed. This does not prove any Circle service
capability and does not retroactively establish which flag the earlier Paseo sessions applied. It narrows the
next investigation: direct native Opus can emit Fast, while the real Paseo Opus ON result above was standard.
Compact nonsecret evidence: [native-fast-request-evidence.json](native-fast-request-evidence.json). Full local
probe script/results remain under `_workspace/native-fast-request-probe/`. No claim of a completed Fast fix.
