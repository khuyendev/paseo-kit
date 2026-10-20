# Live adapters acceptance — 2026-10-20

## Result

**12 named checks pass, 2 fail, 0 blocked. HARN-04 / CR-HAR-09 remain OPEN because F1/F2 are genuine observed GENERATED adapter evidence failures.**

Two real projects were built/tested, installed, and given genuinely agent-generated adapters. Both generated adapters pass lint and execute nonempty tests. Independent protocol execution nevertheless found **requested-target/evidence identity mismatches in both adapters**. The final bounded follow-up corrected TEST TOPOLOGY using legitimate local fixture workspaces, then measured both fixed 10+10 trigger sets through installed new ph: **precision 1.0, recall 1.0 for each skill**. Prior B1–B3 were topology blockers, not established product failures. No generated adapter/skill/history bytes were changed, no generator was given failure feedback, and trigger success does not erase F1/F2.

Counts below are named acceptance checks, not individual TAP assertions or model turns. Generator final claims are not treated as qualification evidence.

| ID | Outcome | Check |
| --- | --- | --- |
| A1 | PASS | Node HTTP baseline: syntax build exit 0; two real loopback-socket tests pass. |
| A2 | PASS | Compiled C# CLI baseline: stock csc produces real executable; two executable-driving tests pass. |
| A3 | PASS | Current kit installs into external Node fixture without enabling plugin; neutral seed retained, test tiers provisioned. |
| A4 | PASS | Same installation and provisioning for compiled fixture. |
| A5 | PASS, narrower old-ph launch claim | Real Node generator creates adapter/stack skill/scripts/history; independently run installed lint, build, test, parser, resolver and runner succeed; test count 2. Evidence coverage is separately FAILED below. |
| A6 | PASS, narrower old-ph launch claim | Real compiled generator creates adapter/stack skill/scripts/history; independently run installed lint, build, test, resolver and runner succeed; full test count 2. Suite-alias evidence coverage is separately FAILED below. |
| A7 | PASS | Compiled `test:greeting` resolves and runs exactly one real test; evidence reports count 1 and target `greeting`. |
| A8 | PASS | Original source/test hashes preserved; both installed kit status checks report every kit part unchanged; generated skills/tools absent from ship; no live tester-owned children at cleanup. |
| F1 | FAIL | Node `test: test/service.test.mjs` evidence does not contain its requested target. |
| F2 | FAIL | Compiled documented `test:all` evidence does not contain its requested target. |
| A9 | PASS | Legitimate fixture parents and all 42 diagnostic/measurement children have actual fixture cwd, correct real parentage, Astra model and medium effort; installed new ph launches without a guard bypass. B1–B3 topology resolved. |
| A10 | PASS | Both fixture parents actually invoke installed `harness` through Skill in read-only audit mode; transcript base directories are the installed fixture skills. No regeneration. |
| A11 | PASS | Node stack: 10/10 should-trigger calls invoke `node-http-stack`; 0/10 near misses do. Precision/recall 1.0/1.0 from actual skills telemetry. |
| A12 | PASS | Compiled stack: 10/10 should-trigger calls invoke `compiled-cli`; 0/10 near misses do. Precision/recall 1.0/1.0 from actual skills telemetry. |

**Not run:** regeneration through a corrected new-ph parent (intentionally forbidden in the follow-up), full GSD lifecycle/gate execution, generated C# syntax checker (none declared), evolve, minimum Node qualification, plugins. All 40 fixed natural trigger requests ran in fresh agents, plus two separate telemetry diagnostics. Both expected fixture `triggers.json` files now exist. Existing generated history rows remain byte-identical, including their historical pending wording; measured results are recorded here and in the trigger files rather than rewriting failed snapshots.

## Roots, versions, safety

- Evidence/scripts (`E` below): `C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/adapters/`.
- External fixtures (`F` below): `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/adapters/`; projects `node-http` and `compiled-cli`.
- Kit (`K`): `C:/Users/fish/Desktop/paseo-kit`, version **0.0.1**, current working-tree install (not an older release).
- Reference launcher (`OLD`): `C:/Users/fish/Desktop/paseo-harness-kit/project/.agents/skills/harness/scripts/paseo_harness.mjs`.
- Node **v24.19.0**, Windows, Git **2.55.0.windows.5**, Paseo CLI **0.11.2**, Claude Code **2.1.296**.
- `dotnet --list-sdks` returned exit 0 with no SDKs. Stock compiler discovered at `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`, **4.8.9221.0 / C# 5**, targeting .NET Framework. This is a compiled C# executable, not transpiled JavaScript.
- .NET home/package variables in fixture scripts point below the isolated acceptance roots; no SDK setup, package install, or global configuration change occurred.
- All ph model commands requested `circle/gpt-6-astra[1m] --effort medium`; public parent bootstraps requested `circle-agent/gpt-6-astra[1m] --thinking medium`. Collected actual model is `circle-agent/gpt-6-astra[1m]`. Follow-up public inspect independently confirms Astra and medium for both parents and all 42 children; original generator result JSON does not independently echo effort.
- No native Agent/Workflow/SendMessage, kit production edits, provider/tool/plugin configuration changes, daemon reload/restart, remote dependency installs, real-project changes, commits, or publish/push. Only own child agents were created. Fixture HTTP listeners bound 127.0.0.1, port 0, and closed in finally.

### Preserved preflight mistakes, not kit failures

The initially assigned path under `K/_workspace/` was a kit descendant. Installation correctly returned exit 1, `failed: the project cannot be the kit itself`. Main then explicitly authorized external `F`; containment was not disabled. Original fixture trees and `E/logs/node-http-install.json` remain.

Initial tester-authored C# build wrapper used forward-slash source paths; stock csc returned CS1504. Only that tester fixture wrapper was corrected to Windows separators before the external baseline. `E/logs/compiled-cli-baseline-build.json` preserves the failure. No generated adapter was hand-fixed.

## Commands actually executed

All runnable scripts are UTF-8 under `E`; they retain exact argv, cwd, exit, stdout/stderr, and protocol stdin in JSON. Commands below use the absolute aliases defined above, not unknown working-directory assumptions.

```text
node E/setup.mjs
node E/compiled-baseline.mjs
node E/external-setup.mjs
node E/snapshot.mjs
node E/launch.mjs node-http
node E/launch-old.mjs node-http
node E/launch-old.mjs compiled-cli
node E/verify-generated.mjs node-http test/service.test.mjs
node E/verify-generated.mjs compiled-cli greeting
node E/verify-generated.mjs compiled-cli all all
node E/launch-trigger-supervisor.mjs node-http
node E/launch-trigger-supervisor.mjs compiled-cli
node E/inspect-artifacts.mjs
```

`external-setup.mjs` executes, per fixture:

```text
git init
node K/kit.mjs install F/<lane>
```

No `--enable-plugin`. Node baseline commands: `node --check src/server.mjs`; `node --test --test-reporter=tap test/service.test.mjs`. Compiled baseline: `node build.mjs`; `node --test --test-reporter=tap test/cli.test.mjs`. Both fixtures are independent git repos, without commits. Both baseline suites execute 2 tests.

Original neutral overlays are `E/<lane>-neutral-overlay.json`. Before generation only the three test tiers and `max_subagents: 4` were set. Seven map files per fixture (`STACK`, `ARCHITECTURE`, `STRUCTURE`, `TESTING`, `CONVENTIONS`, `INTEGRATIONS`, `CONCERNS`) explicitly say **TEST-AUTHORED INPUT — not generated by GSD mapping**.

## Real generation and retained artifacts

Installed-new-ph generation initially ran with `PASEO_HARNESS_ROOT=F/node-http`:

```text
node F/node-http/.agents/harness/ph.mjs fanout --file E/generate.txt --model circle/gpt-6-astra[1m] --effort medium --cwd F/node-http --collect E/generation-node-http
```

It returned exit 1 because caller `12d193f9` is actually hosted at `C:/Users/fish/Desktop/paseo-harness-kit`, outside the fixture. Raw evidence: `E/launch-node-http.json`. This is not evidence that new-ph generation succeeded.

Authorized old-ph fallback initially rejected the new overlay's `adapter` key; both `E/launch-old-<lane>.json` failures are retained. Subsequent fallback used an isolated old-compatible supervisor overlay at `E/.agents/harness.config.json` with only tiers and max_subagents, not a patched product or weakened safeguard:

```text
PASEO_HARNESS_ROOT=E node OLD fanout --file E/generate-old-<lane>.txt --model circle/gpt-6-astra[1m] --effort medium --cwd F/<lane> --collect E/generation-old-<lane>
```

The initial prompts explicitly required installed harness SKILL.md plus kit-adapter method if Skill was unavailable, inspection of real source, no hand-authored adapter, no recursive agents, and honest pending trigger status. Original generator `skills` arrays are empty; **harness Skill invocation during original generation is not claimed**. The separate final read-only audit does prove installed harness Skill discovery, without altering that original generation claim. Actual artifacts and independently executed public commands establish the narrower generation result.

| Project | Actual generator ID | Tracked input / cached / output tokens | Duration |
| --- | --- | --- | --- |
| Node | `0955955c-043f-4638-9cc2-d8e28d51e7c1` | 116032 / 1241344 / 11396 | 412 s |
| Compiled | `f19ee0ca-7134-4476-ad2d-9a435f48b900` | 110432 / 1255168 / 9226 | 301 s |

Raw prompts: `generate-old-<lane>.txt`; launch commands: `launch-old-isolated-<lane>.json`; complete final/model/usage/results: `generation-old-<lane>/generate-<lane>.json` and `.md`. The first attempted fallback logs remain distinct from successful launches.

Generated files live under each fixture: `.agents/harness.config.json`, `.agents/harness-history.md`, `CLAUDE.md`, one `.claude/skills/<stack>/SKILL.md`, and `tools/adapter/*.mjs`. Skills are **node-http-stack** and **compiled-cli**. No custom GSD agents were needed. Snapshots and hashes: `E/generated-snapshot-<lane>/` and `E/artifact-inspection.json`. Generator-owned raw validation logs and complete file inventories remain at each fixture's `_workspace/generator-evidence/`.

Independent lint: Node 0 failures/1 missing-trigger warning (8 files); compiled 0 failures/1 missing-trigger warning (7 files), both exit 0. Both declared build/test commands exit 0 with 2 actual tests. Resolver missing-target negative cases reject. Source/test hashes match `E/baseline-snapshot.json`. `kit status` independently reports every installed kit part unchanged: `E/status-<lane>.json`; generated stack folders and adapter tools are absent from `K/ship/`.

## Failed independent evidence checks — stop these paths

### F1: Node file obligation versus test-name evidence

Reproduction: `node E/verify-generated.mjs node-http test/service.test.mjs` exits **1** after successfully running installed config/lint, real build/tests, parser/resolver and declared verify runner.

- Parse/resolve requested target: `["test/service.test.mjs"]`, resolver says ok.
- Real TAP runner: exit 0, **2 tests executed**, health and missing.
- Generated evidence response: `{"v":1,"executed":{"count":2,"targets":["health","missing"]},"failed":[],"outcome":"passed"}`.
- Required file identity **`test/service.test.mjs` is absent** from executed targets. Independent assertion fails; the adapter's own `passed` text does not certify this obligation.
- Raw evidence: `E/verification-node-http/{parse,resolve,verify-runner,evidence,checks}.json`, plus `.stdout/.stderr` files.

### F2: Compiled suite alias versus test-name evidence

Reproduction: `node E/verify-generated.mjs compiled-cli all all` exits **1** after successful lint/build/tests/resolver/runner.

- Generated skill explicitly documents `test:all`; resolver accepts target `["all"]`.
- Real runner rebuilds the executable and executes greeting and usage, exit 0, count 2.
- Generated response: `{"v":1,"executed":{"count":2,"targets":["greeting","usage"]},"failed":[],"outcome":"passed"}`.
- Required identity **`all` is absent**. Raw evidence: `E/verification-compiled-cli-all/{resolve,verify-runner,evidence,checks}.json`.
- Control: `test:greeting` does work, count 1 and target greeting; `E/verification-compiled-cli/summary.json` records 26 passing checks.

Both violate documented requested-target coverage (INTERFACES section 11; ADPT-17). Read-only confirmation of the implementation: `ship/.agents/harness/adapter/evidence.mjs:32-37` rejects requested targets missing from `executed.targets`. No kit module was imported as a test substitute; verification executed real CLI commands and generated stdin/stdout hooks. A full GSD gate was **not run** and is not claimed to have failed live. Generated-output paths were stopped at these assertions; neither output was repaired or sent back for an acceptance-driven fix.

## Historical trigger topology blockers — preserved, now resolved

An essential old-ph supervisor was bootstrapped per fixture solely to attempt the installed new-ph trigger boundary with genuine caller identity. These were not recursive coding teams. Each supervisor ran `node E/run-triggers.mjs <lane>`; the script preflights explicit Skill invocation via installed new `ph fanout --collect`, then would run the fixed 10-positive/10-negative cases with max_subagents=4 only after identifiable skill telemetry.

- Node supervisor: `3daccfd0-1691-4fc8-a780-1ddad07a5e8a`.
- Compiled supervisor: `1644285e-2710-41ef-947b-2f8290b4ea11`.
- Actual collected model for both: `circle-agent/gpt-6-astra[1m]`.
- Despite old-ph `--cwd F/<lane>`, new ph observes both actual callers in **`C:/Users/fish/Desktop/paseo-harness-kit`**, and returns exit 1 before creating the diagnostic child.
- Exact commands and refusal stderr: `E/triggers-<lane>/telemetry-command.json`. Terminal driver status: `E/triggers-<lane>/status.json` says blocked. Planned 40 read-only cases: `E/trigger-cases.json`.
- Supervisor collected finals say their background driver was pending; they are **not** completion evidence. The independently read terminal driver artifacts establish the actual refusal.
- No caller ID spoofing, root-containment override, provider change, fake classifier, old-ph replacement for measured trigger agents, or fabricated trigger file/precision/recall.

## Final bounded follow-up: actual trigger measurement

Main identified B1–B3 as TEST TOPOLOGY and authorized one genuine local fixture parent per lane. The proven runtime bootstrap was read, not edited. `E/bootstrap-hosted.mjs <lane>` invoked the public CLI exactly as recorded in `bootstrap-hosted-<lane>-command.json`:

```text
node C:/Users/fish/AppData/Roaming/npm/node_modules/@getpaseo/cli/bin/paseo run --provider circle-agent/gpt-6-astra[1m] --thinking medium --title adapters-hosted-<lane> --new-workspace local --cwd F/<lane> --env PASEO_HARNESS_ROOT=F/<lane> --wait-timeout 10m --json <retained literal prompt>
```

| Lane | Genuine parent | Owned workspace | Parent Claude session |
| --- | --- | --- | --- |
| Node | `76946a6c-2e67-4a44-ac0c-a9f508cfe610` | `wks_67e2fac1a82796ec` | `4dba8c70-45f8-4667-b1a8-c04d2a5b240b` |
| Compiled | `fb021d86-0d38-499f-a42c-b46f684d264e` | `wks_4ac3b366398bf176` | `28a36e46-283f-4c3b-9d0b-ffefcb7a30aa` |

Public inspect confirms actual parent cwd equals its external fixture, not the old kit workspace. No ID/environment impersonation, root guard change, or provider modification. Each parent invoked Skill `harness` with `READ-ONLY AUDIT mode: audit only, no generation, edits, orchestration, or tests; only identify its installed purpose.` Exact tool calls and returned installed base directories are in `E/hosted-harness-discovery.json`, extracted only from these two known fixture transcripts (2 MB/file cap).

Both default-mode parents requested permission for the exact test command `node "E/hosted-triggers.mjs" <lane>`, foreground, timeout 600000. Exact inputs were independently read before allowing once:

- Node request `permission-f088c15f-d8fc-4172-aabd-a06706587368`.
- Compiled request `permission-ff7d8142-ce3f-404c-bf8e-3af4fcddd5f5`.
- Evidence: `hosted-parent-tools-<lane>-permission.json`, `hosted-own-permissions-initial.json`, `hosted-node-permit.json`, `hosted-compiled-permit.json`. No persistent allow rule, policy-denial override, mode change or modified command.

`hosted-triggers.mjs` uses the installed NEW `ph fanout --file <cases> --model circle/gpt-6-astra[1m] --effort medium --read-only --cwd F/<lane> --collect <dir>`. First it performs one explicit Skill telemetry diagnostic, then a positive/negative preflight, then the remaining 18 fixed requests. At most 4 direct children run per parent, controlled by unchanged max_subagents=4. Each request uses a new actual ID. No classifier or model self-report is used for grading: the collected `skills` array, derived from actual tool telemetry, decides invocation.

| Stack | Measured requests | TP / FP / FN / TN | Precision | Recall | Measured-turn tokens input / cached / output |
| --- | ---: | --- | ---: | ---: | --- |
| node-http-stack | 20 (10+10) | 10 / 0 / 0 / 10 | 1.0 | 1.0 | 301039 / 305792 / 5401 |
| compiled-cli | 20 (10+10) | 10 / 0 / 0 / 10 | 1.0 | 1.0 | 321571 / 300544 / 5278 |

Raw evidence per lane: `E/triggers-hosted-<lane>/{telemetry,preflight,remaining}/` contains all 21 result JSONs with actual ID/model/final/usage/tokens/skills and matching final text; batch `.txt` files retain exact prompts; `*-command.json` retain full commands/exit/stdout/stderr; `observations.json` records each classification. `E/hosted-independent-verification.json` independently recalculates results from those raw files, and `hosted-final-audit.json` verifies 21 unique IDs per lane, exact actual cwd/parentage, Astra/medium, source hashes, and record cardinality. The fixed request text is unchanged from `E/trigger-cases.json`.

The diagnostic IDs are `50624479-6750-48c9-94fe-c7a2b1a66d90` (Node) and `42383726-b967-4452-97db-5ae0bc647ce8` (compiled); their collected `skills` are respectively `["node-http-stack"]` and `["compiled-cli"]`. Independent bounded public timelines (`timeline-<id>.json`, tail 60) also show actual `[Skill] node-http-stack` for positive `8e63cd87-6d94-4ba9-aea6-96f201be6b3f`, and `[Skill] compiled-cli` for positive `db8471eb-7fa3-4d84-bffe-2dff237325ed`; matched near-miss timelines contain no Skill invocation. This corroborates metadata rather than trusting final assertions.

Expected records written only after measurement:

- `F/node-http/.agents/skill-tests/node-http-stack/triggers.json`
- `F/compiled-cli/.agents/skill-tests/compiled-cli/triggers.json`

**F1/F2 remain unchanged and FAILED.** Before/after SHA256 checks against `E/artifact-inspection.json` prove every generated adapter, skill, script, history and CLAUDE.md byte remains identical to the failed snapshots. Original source/test hashes are also unchanged. The only new fixture content in this follow-up is measured trigger records. No failure feedback went to a generator; no acceptance-driven repairs, reruns of generation, extra review rounds, or production edits occurred.

## Cleanup and remaining qualification

Original four owned agents were collected/archived by old-ph; the initial empty-pool evidence remains `E/cleanup-new-team.log`. In the final follow-up, all **42** new diagnostic/measurement children were archived by installed new-ph collection; independent `paseo inspect --json` snapshots in each `triggers-hosted-<lane>/child-inspections.json` confirm `Archived: true`, exact fixture parent/cwd, Astra and medium. Both driver cleanup/team records show no remaining direct children.

After inspecting results, `E/cleanup-hosted.mjs` archived only the two owned fixture parents and their two newly created local workspaces via public `paseo archive` / `paseo workspace archive`. Every exit is 0; independent parent readback confirms archived; local fixture files remain. Complete cleanup commands and readbacks: `E/hosted-cleanup.json`. All follow-up agents/workspaces are cleaned up. No persistent server was launched, no owner settings changed, and successful/failed artifacts remain for diagnosis.

**Do not close HARN-04 or CR-HAR-09.** Trigger qualification and test topology are now resolved, but generated requested-target evidence semantics F1/F2 still require an owner-authorized correction and subsequent live requalification. No further retry or review round was undertaken.
