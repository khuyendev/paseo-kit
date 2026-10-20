# Live adapter requalification — 2026-10-20

## Result

**2 adapters pass, 0 fail, 0 blocked. HARN-04 and CR-HAR-09 are CLOSED for this bounded live requalification.**

Both fresh generators actually invoked the installed `harness` Skill. Both generated adapters passed independent real build/test execution, declared selector coverage, isolated negative controls, generated self-checks, fresh 10-positive/10-near-miss trigger measurement, and final lint. No generated output was authored or repaired by the tester, and no historical failure answer was supplied to either generator.

This closes the two adapter qualification failures, not a full GSD lifecycle or universal stack-support claim. Worker tool enforcement is **policy readback only**, as explained below; no runtime tool-surface exposure or SendMessage denial probe is claimed.

| Fixture | Real baseline / declared tests | Independent selector checks | Isolated negatives | Fresh triggers TP/FP/FN/TN | Final lint | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| Node HTTP | 2 / 2 | 5 supported, 2 rejected | 5/5 rejected correctly | 10/0/0/10 | exit 0; 0 failures, 4 warnings | PASS |
| Compiled C# CLI | 2 / 2 | 6 supported, 2 rejected | 5/5 rejected correctly | 10/0/0/10 | exit 0; 0 failures, 0 warnings | PASS |

Counts are adapters, not individual assertions. Generated self-checks provide additional negative/unsupported-selector coverage beyond the independent controls in this table.

## Roots and reproducibility

- Kit **K**: `C:/Users/fish/Desktop/paseo-kit`.
- Tester evidence/scripts **E**: `K/_workspace/live-fix/requalification/`.
- Fresh external base **F**: `C:/Users/fish/Desktop/paseo-kit-live-fix-tests-20261020/`.
- Positive fixtures: `F/adapters/node-http` and `F/adapters/compiled-cli`.
- Independent negative copies: `F/controls-node-http` and `F/controls-compiled-cli`.
- Historical fixtures at `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/adapters/` were read only, never modified.
- Compact non-secret summary: `.planning/integration/requalify-evidence.json`.

Node was v24.19.0, Paseo CLI 0.11.2, Claude Code 2.1.296, on Windows. The compiled lane used the real `C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe`; no SDK or global package was installed. Its original `build.mjs` uses Windows-separated compiler arguments and produces the actual executable driven by the original tests.

`E/setup.mjs` created new directories with non-overwriting creation, initialized two independent Git repositories, copied only the original baseline allowlist, ran builds/tests, and installed the current working-tree kit using `node K/kit.mjs install <fixture>` without `--enable-plugin`.

Allowlisted files were Node `.gitignore`, `package.json`, `src/server.mjs`, `test/service.test.mjs`; compiled `.gitignore`, `build.mjs`, `src/Program.cs`, `test/cli.test.mjs`; plus the seven explicitly **TEST-AUTHORED** codebase maps in each fixture. No old adapter, tools, skills, installed kit, history or trigger record was copied. No claim that map-codebase ran is made.

The original setup scripts and `baseline-snapshot.json` were consulted. Baseline build/test command records are `E/<lane>-{build,test}.json`; both test outputs show two tests, zero failures/skips. `E/baseline.json` contains copied-input hashes and installed-overlay hashes. The installed kit-adapter reference matched current ship bytes. Neutral overlays are retained as `E/<lane>-neutral-overlay.json`; before generation only the three tiers were provisioned as Astra medium and `max_subagents` set to 4.

## Genuine generation and installed Skill proof

The public launch was, separately for each new fixture:

```text
node <public Paseo CLI> run --new-workspace local --cwd <fixture> --provider circle-agent/gpt-6-astra[1m] --thinking medium --env PASEO_HARNESS_ROOT=<fixture> --title requalify-generate-<lane> --wait-timeout 20m --json <literal retained prompt>
```

| Lane | Genuine generator/parent | New local workspace | Host transcript session |
| --- | --- | --- | --- |
| Node | `492f8a01-82fb-4010-bb21-9b5dc6f4df3d` | `wks_17f574ffd239550b` | `c13559b4-1415-4cfe-b98c-1d128f929c7b` |
| Compiled | `b97ca5b0-412d-4f22-98ea-dfac24564f06` | `wks_e83fafbace61f715` | `0ca687e6-27d6-492d-ae8b-79d18199488b` |

Public `inspect` confirms actual cwd equals each external fixture, parent is tester `4b84639a-ca3e-4233-aa8d-cb504445e34e`, provider/model is `circle-agent/gpt-6-astra[1m]`, and thinking is medium. No old-ph cwd substitution, caller spoofing or guard override was used.

Both transcripts contain actual `Skill` calls with `{skill:"harness"}`, followed by skill content whose base directory is that fixture's `.claude/skills/harness`. Evidence is `E/<lane>-transcript-final.json` (tool calls and extracted bases) and `E/<lane>-transcript.jsonl` (full raw session). Literal launch prompts and commands are in `E/launch-<lane>-command.json`; initial public returns and final generation output are retained in launch results, `node-wait-final.json`, `compiled-wait-final.json`, and the raw transcripts.

Prompts described the fixture goal and requested the installed default harness procedure under owner consent, with preservation/model/safety limits and separately owned trigger measurement. The repaired identity rules and required readiness checks came from the shipped Skill/overlay—not a tester-supplied answer. No extra native team was requested or launched. Generator-owned initial JSON/schema mistakes were corrected within their original generation turns using the kit's validation feedback; all unsuccessful attempts remain in the transcripts. The tester supplied no failure feedback or repair patch and requested no second generation round.

Parents ran in public default/Always Ask mode. Exact requested fixture reads/writes and shell commands were inspected before individual `paseo permit allow <own-agent> <request-id>` approvals. `permissions-*`, `*-permit*.json`, and `*-transcript-requests-*.json` retain these requests and approvals. There were no persistent allow rules, provider-mode changes, actual deny bypasses or owner-setting edits.

## Independent execution and the original failures

`E/inspect-generated.mjs <lane>` independently ran installed `ph config`, `ph harness lint`, the generated declared build/test argv, and `kit.mjs status`. Both configs and builds/tests passed; each declared suite executed two cases. Both installed status checks reported every kit part unchanged. Generated output was inspected from its actual files, not accepted from the generator's final claims.

All selector checks used the installed dynamic CLI, not a replacement parser or an imported test fake:

```text
node <fixture>/.agents/harness/adapter/check.mjs --kind test --command <obligation> --run --output <fresh evidence parent>
```

`E/check-selector.mjs` records literal argv, cwd, exit, stdout/stderr, complete check record and independent expected identities. Full protocol JSON and raw runner logs are under `E/<lane>-checks/`. `E/audit-evidence.mjs` independently parses raw completion records and final summaries; results are `E/independent-evidence-audit.json`.

### LA-01: Node multi-test file — now supported and correctly normalized

Canonical IDs are `test/service.test.mjs::health` and `test/service.test.mjs::missing`.

| Obligation | Outcome / actual coverage |
| --- | --- |
| Original `test: test/service.test.mjs` | exit 0; parser expands to both concrete IDs; both resolve unchanged; two actual completed records prove both |
| Documented `test:test/service.test.mjs` | same two IDs/count 2 |
| Documented `test:service` | same two IDs/count 2 |
| `test:test/service.test.mjs::health` | exactly health/count 1 |
| `test:test/service.test.mjs::missing` | exactly missing/count 1 |
| `test:health`, `test:unknown` | exit 2, explicit unknown-selector error, no runner |

The generated catalog is a reviewed registry pinned to the original test-file hash. It supplies selection, not fabricated execution. The runner consumes canonical IDs via anchored escaped filters. Evidence derives path/name identities from actual completed Node events and requires the successful final summary. Unsupported bare names, globs, regexes, absolute/backslash paths and unknown aliases are documented as unsupported. The generated self-check also asserts their rejection.

### LA-02: compiled suite alias — old spelling rejected; documented canonical equivalent passes

Canonical IDs are `test/cli.test.mjs#greeting` and `test/cli.test.mjs#usage`.

| Obligation | Outcome / actual coverage |
| --- | --- |
| Original `test:all` | exit 2: `Unknown test selector: all`; no runner starts |
| Documented `test:cli` | exit 0; parser expands to both concrete IDs; count 2 and both identities proven |
| Documented `test:test/cli.test.mjs` | same two IDs/count 2 |
| `test:greeting`, `test:test/cli.test.mjs#greeting` | exactly greeting/count 1 each |
| `test:usage`, `test:test/cli.test.mjs#usage` | exactly usage/count 1 each |
| `test:unknown` | exit 2 before runner |

The new skill explicitly enumerates the supported suite alias `cli` and rejects arbitrary aliases; it does not advertise `all`. The old spelling was tested verbatim, not silently dropped. The canonical suite and file equivalents preserve the full expected greeting+usage coverage. The runner recompiles the real executable before selected tests. Evidence constructs IDs from completed raw TAP records, checks the final TAP plan/summaries, excludes skips/TODOs, and never copies requested IDs into executed targets. Gate coverage rejects a missing member even if the evidence hook's partial run itself has a passing TAP summary.

## Negative controls and generated readiness checks

`E/negatives.mjs <lane>` made independent isolated copies under F, leaving positive fixture bytes untouched. It changed only the copied overlay's runner (and, for missing resolution, an explicitly synthetic parser). These are labeled **synthetic negative injections**, never claimed as real passing execution.

For each lane:

- Zero-run output: exit 2, count 0, empty executed targets; never green.
- One missing executed member: exit 2, only the actual supplied member reported; absent target not fabricated.
- Failed runner despite complete passing-looking records: exit 2, runner failure retained.
- Unknown selector: exit 2 before runner; no marker/log.
- Missing resolved target: exit 2 with `missing`, before runner; no marker/log.

All ten independent negative expectations passed. Full injected output, exact runner argv/exit, marker presence and complete checker records are under `E/<lane>-negatives/`; summaries are `<lane>-negatives/summary.json`.

The tester also reran each generated `node tools/adapter/self-check.mjs` unchanged:

- Node: exit 0, four real positives, eight unsupported-selector rejections, nine synthetic controls. Fresh result: `F/adapters/node-http/_workspace/harness-generation/self-check-jBQRzE/summary.json`.
- Compiled: exit 0, six real positives, nine synthetic controls and original-file preservation. Fresh result: `F/adapters/compiled-cli/_workspace/harness-generation/self-check-VXebwF/results.json`.
- Node generation-only `node tools/adapter/validate.mjs` was independently run before trigger measurement: exit 0; `validation-R5FeHt/summary.json`. It checks the intentionally pending trigger state, so final post-measurement validation is the required installed lint, not a claim that this pre-measurement-only assertion was rerun afterward.

The generated checks include independent expected IDs/counts and raw-log inspection. Node additionally covers skipped members, missing completion, failed-case records and catalog drift. Both explicitly limit support to their flat fixture test shapes; nested/dynamic discovery is not claimed.

## Fresh trigger qualification

Each genuine parent received only a follow-up to run `E/triggers.mjs <lane>`, with no regeneration or output edits. Exact inspected driver calls were approved once. The driver invoked the fixture's **installed new** `ph fanout --collect`, with explicit `circle/gpt-6-astra[1m] --effort medium --read-only`, fixture cwd/root, and unchanged cap 4.

The previous fixed 10-positive/10-near-miss requests were reused verbatim; **no request text or name adaptation was needed**. Node's new stack folder is `node-http-service`; compiled is `compiled-cli`. The old 40 results were not reused. All 40 observations came from new IDs, with actual collected `skills` arrays deciding invocation—not model self-classification. Independent sample public timelines corroborate actual Skill calls on positives and absence on near misses.

Both skills measured precision 1.0 and recall 1.0. `E/audit-triggers.mjs` independently recalculated results, inspected all 40 agents, confirmed actual cwd/parent/model/medium, and computed maximum live children from creation/archival timestamps: **4 per fixture**. All children were archived by collection. Evidence: `E/triggers-<lane>/{collected,observations.json,child-inspections.json,independent-audit.json,timeline-*.json}`; exact prompts/commands are `requests.txt` and `fanout-command.json`.

Only after measurement, correct records were written to each fixture's `.agents/skill-tests/<stack>/triggers.json`. Original generated skills, tools, config, history and CLAUDE bytes stayed unchanged. Their pending-generation notes remain historical; measured status is in trigger records and this report, not a hand-edited generation artifact.

Final installed lint ran after measurement: compiled 0 failures/0 warnings; Node 0 failures/4 warnings. Node's four warnings are literal prohibited-tool names inside `validate.mjs`'s static prohibition regex, not operational calls. Exact results: `E/triggers-<lane>/final-lint-command.json`.

## Preservation, policy and cleanup

`E/independent-evidence-audit.json` verifies all copied source/test/build/bootstrap/map hashes remain equal to the fresh baseline, and every snapshotted generated output remains byte-identical after independent checks and triggers. No kit production code/specification, historical failed fixture, provider setting or owner configuration was changed. No commits, global installs or daemon reload/restart occurred.

Worker policy readback contains `SendMessage` in `circle-agent.disallowedTools`; main `circle` remains exactly `Agent, Workflow`. Before/after hashes of the owner daemon configuration match: `67963a95fc2790b5f3e05f74afa895884cb7a1d3b326d970dfedf30cef6c2e7a`. Artifacts store only this hash and denial lists, not secrets. Fresh public inspect confirms worker provider/model/effort, but exposes no actual loaded host tool surface. Therefore **policy readback only** is the enforcement claim. SendMessage was never called. Both fixture doctor runs independently exited 0 before and after generation; records are `E/<lane>-doctor-{before,after}.json`. Doctor's existing upstream warning and unselected file mod are not concealed.

All 40 owned trigger children and both owned parents are archived. Only the two newly owned local workspaces were archived; public readbacks confirm success, and local fixture/log files remain. Cleanup records: `node-parent-cleanup.json`, `compiled-parent-cleanup.json`, `*-workspace-cleanup.json`, and `*-parent-final.json`. Both installed team checks reported `no live subagents`. No persistent server was started; socket tests close their loopback listeners. No unrelated agents/workspaces were touched.

## Qualification boundary

There are **no remaining reproducible failures in the requested two-adapter requalification**. No additional automatic generation/review round was undertaken. Not run or claimed: full GSD planning/execution/gate lifecycle, optional behavioral A/B, minimum-Node/POSIX portability, arbitrary nested test suites, or runtime enforcement proof beyond the explicit policy-readback limitation. Closing HARN-04/CR-HAR-09 does not waive those separate coverage boundaries.
