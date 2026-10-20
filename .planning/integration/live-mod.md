# Live mod acceptance — 2026-10-20

## Continued result

**12 pass, 0 fail, 0 blocked.** Previous operations/denial lane: **10 pass, 0 fail, 0 blocked** (preserved). Additional public installer-activation lane: **2 pass, 0 fail, 0 blocked**. Real Claude Code sessions ran against real installed fixtures. **Calibrated native and mod permission-denial controls both passed, with unchanged bytes.** The earlier `Write(path)` test used an unsupported filesystem permission rule and is invalid/uncalibrated, not a demonstrated product defect; its evidence is retained below. No mock/offline test is counted and no final agent assertion substitutes for byte/log inspection.

| Check | Status | Independently inspected evidence |
| --- | --- | --- |
| Real shipped-plugin validation | PASS | Old `validate-plugin.log`, exit 0 |
| Real marketplace validation | PASS | Old `validate-marketplace.log`, exit 0; missing-description warning |
| Public CLI installation at corrected external fixture | PASS | New `install.log`, exit 0 |
| Actual host loading, exactly three upfront mod tools | PASS | `operations-host.jsonl:4,6`; plugin connected and read called without ToolSearch |
| Real `read_ranges` | PASS | `operations-host.jsonl:15`; four lines, session tag `cot1`; completed backend receipt |
| Tagged line edit | PASS | `operations-host.jsonl:16,25`; exact file bytes verified independently |
| Batch write, nested parent and UTF-8 | PASS | `operations-host.jsonl:26,35`; both exact byte sequences verified independently |
| Native Bash ticket/hook path and ordinary one-shot outcomes | PASS | Six successful PreToolUse:Bash and six PostToolUse:Bash events for three operations, three completed private receipts, one model call per operation; exact target bytes |
| Calibrated native Write denial | PASS | `calibrated-native-verification.json`: actual permission refusal, one Write attempt, identical before/after bytes |
| Mod write denial under identical effective Edit path rules | PASS | `calibrated-mod-verification.json`: `Write permission deny`, one mod attempt, identical before/after bytes |

Excluded from pass/fail counts: old `denial-host.jsonl` used unsupported `Write(./denied.txt)` filesystem rule syntax. It remains an invalid/uncalibrated tester case, not product failure.

The earlier internal fixture location was a **test-layout mistake in the original brief**, not a product failure. Installer correctly rejected a descendant of the kit. The owner then explicitly authorized `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/`; installation there succeeded without changing or bypassing containment. Old preflight evidence is preserved.

## Environment, paths and isolation

- Windows 11; Node **v24.19.0**; real Claude Code **2.1.296** (declared minimum); harness-files **0.1.0**.
- Kit: `C:/Users/fish/Desktop/paseo-kit`.
- Old area/scripts: `C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/`.
- New area/evidence: `C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/`.
- Installed fixture: `<new>/fixture/`.
- Host environment: `CLAUDE_CONFIG_DIR=<new>/config`, `PASEO_HOME=<new>/paseo-home`, `TMP=TEMP=<new>/tmp`, `PASEO_HARNESS_ROOT=CLAUDE_PROJECT_DIR=<new>/fixture`.
- Both model sessions: inherited circle endpoint/auth environment, CLI model **gpt-6-astra[1m]**, `--effort medium` and `CLAUDE_CODE_EFFORT_LEVEL=medium`. Actual init/result logs identify Astra. Host emits an `unrecognized_model` diagnostic but both sessions complete successfully through the inherited endpoint. No endpoint/credential values copied or printed.
- Session-only `--plugin-dir` loads the fixture's installed plugin. No marketplace registration, plugin install/enable in owner settings, or installer `--enable-plugin` activation was performed. This proves direct host loading, **not installer activation**.
- `--setting-sources project --strict-mcp-config`; fixture's installer-generated hooks remain unchanged. `--permission-mode dontAsk --permission-prompts none`, explicit tool allowlist; Agent/Workflow/SendMessage denied. No native agents were used.

## Exact commands and retained evidence

All test scripts live in the old assigned script directory. Commands actually run:

```text
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/preflight.mjs
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/continued.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/session.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod operations
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/session.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod denial
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/verify.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod
```

Preflight executes real `claude --version`, `claude plugin --help`, `claude --help`, and:

```text
claude plugin validate C:/Users/fish/Desktop/paseo-kit/ship/.claude/plugins/harness-files
claude plugin validate C:/Users/fish/Desktop/paseo-kit/ship/.claude/plugins
node C:/Users/fish/Desktop/paseo-kit/kit.mjs install <fixture>
```

Its exact executable argv/status/output are in old `version.log`, `plugin-help.log`, `claude-help.log`, `validate-plugin.log`, `validate-marketplace.log`, `install.log`; auth booleans only in `auth-presence.json`. Continued install argv/output are in new `install.log`. Installer timeout: 60 seconds.

Both host invocations use `C:/Users/fish/.local/bin/claude.exe`, cwd `<new>/fixture`, timeout **240 seconds**. Exact argv including complete prompts are retained in `operations-host-command.json` and `denial-host-command.json`. Shared flags:

```text
-p --model gpt-6-astra[1m] --effort medium
--output-format stream-json --verbose --include-hook-events
--plugin-dir <fixture>/.claude/plugins/harness-files
--setting-sources project --strict-mcp-config
--permission-mode dontAsk --permission-prompts none
--allowedTools Read,Edit,Write,Bash,mcp__harness-files__read_ranges,mcp__harness-files__edit_multiple_files,mcp__harness-files__write_multiple_files
--disallowedTools Agent,Workflow,SendMessage
-- <prompt>
```

For denial the last option value is **`Agent,Workflow,SendMessage,Write(./denied.txt)`**. Prompts forbid fallback/retry and outside-fixture access. An initial operations invocation omitted `--` before its prompt, so the variadic option consumed the prompt: exit 1, no model call. Those tester CLI-error artifacts remain separately as `operations-command.json`, `operations.stderr.log`, `operations-exit.json`, and `operations.jsonl`; corrected runs use `*-host*` names, so nothing was overwritten.

Raw new evidence:

- `operations-host.jsonl`, `operations-host.stderr.log`, `operations-host-exit.json` (exit 0).
- `denial-host.jsonl`, `denial-host.stderr.log`, `denial-host-exit.json` (exit 0; historical invalid/uncalibrated rule case).
- `verification.json`: expected/actual hex and SHA-256 for all four targets, exact tool calls, hook responses and full completed receipt content/path.
- `tmp/paseo-harness-files-user/56debadc532508b7666bccba1c6d123b9a59233293c75204c57cc745f2bfdd10/`: three operation receipts and state.
- `tmp/paseo-harness-files-user/e9432928bae687546c48efc6504ae6de70ad17f7a3df577d85f9fe9d2f9134e6/`: denial-attempt completed write receipt and state.
- Own host transcripts below `config/projects/C--Users-fish-Desktop-paseo-kit-live-tests-20261020-mod-fixture/` for session IDs `61539992-67ca-4703-a550-96f63346147c` and `c9214398-65fb-44b5-87b9-23353613f445`.

## Historical invalid/uncalibrated denial case and byte results

The fixture creator seeded `denied.txt` as UTF-8 `DENIED MUST STAY\n`. The constrained session made exactly one mod write attempt with an absolute Windows path to that file, content `SHOULD NOT WRITE\n`. The mod returned `wrote ...denied.txt (17 chars)`, and the actual file is that new content. A completed backend write receipt and two native Bash hook pairs corroborate execution. No deny response, fallback, shell command from the model, retry, or second mutation occurred.

This is an **invalid/uncalibrated acceptance case**: the tester used `Write(path)`, which is not matched as a filesystem write permission rule. The supported rule is `Edit(path)`, covering Write/Edit/NotebookEdit. The paired controls below establish that the supported rule denies both native Write and the mod write. Thus this observation does **not** demonstrate a product defect. The old changed target, exact CLI rule and logs remain preserved; it was not restored or reused.

Independent byte assertions:

```text
sample.txt             alpha\nBETA-EDITED\ngamma\n   PASS
output-one.txt         one-shot\n                   PASS
nested/output-two.txt  café\n (UTF-8)                PASS
denied.txt             expected DENIED MUST STAY\n  FAIL
                       actual SHOULD NOT WRITE\n
```

The ordinary successful session has exactly one read, one edit, one batch write, with one receipt for each. This verifies normal one-shot outcomes; no crash/replay or receipt-recovery failure was injected. Hook events prove actual native Bash pre/post hooks executed in the host, not a fake engine. The stream does not expose the nested native command strings or sentinel text, so those details are not independently transcript-qualified beyond successful completed receipts and actual hook execution. No syntax-checker or long-heredoc behavior is inferred from empty successful hook output.

## Not run / remaining unverified

- Installer activation is now verified in the separate added lane below; the earlier operations/denial lane used the supported direct `--plugin-dir` alternative.
- Actual owner circle permission mode versus `ph spawn` worker mode (FTOL-10); these were direct isolated host sessions with explicit `dontAsk` permissions, not daemon worker launches.
- Denial with correctly specified Edit path rules is now verified by the paired fresh-session controls below; other permission modes and parent-only/canonical-path denial variants remain unverified.
- Crash/retry at-most-once recovery, receipt replay, pagination, stale tags, adversarial canonical path changes and parent-only permission refusal.
- Specialized hook semantics: transcript context thresholds, syntax checker outputs, long-command rescue, latency p95.

README, INTERFACES, code-final and FTOL requirements were read before execution. No fake daemon, direct-import unit test or mocked host was used.

## Calibrated fresh-session denial controls

After loading the host `update-config` guidance, used its documented `Edit(path)` file-write deny syntax, through the supported `--disallowedTools` CLI source. No settings file was edited. Both fresh processes used the **identical full rule list**, identical cwd, allowlist, isolated home/config, project settings source, plugin-dir and permission mode:

```text
--disallowedTools Agent,Workflow,SendMessage,Edit(./calibrated-native.txt),Edit(./calibrated-mod.txt)
```

Both new target files were created exclusively (`flag: wx`) with original UTF-8 sentinel `DENIED MUST STAY\n`. The model was asked for exactly one write attempt and no read, fallback or retry. The native control ran first; the runner refuses to launch the mod control unless the native result proves an actual permission denial and unchanged bytes. Both calls used absolute target paths, matching the earlier target form. Both sessions used Astra `gpt-6-astra[1m]`, effort medium, 240-second timeout and all shared host flags documented above.

Exact added commands (test script in old assigned directory):

```text
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/deny-controls.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod native
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/deny-controls.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod mod
```

Native session `89f9a6ac-abaa-433b-86b6-c19fa99ac11b`: exactly one `Write` call on `calibrated-native.txt`, attempted content `SHOULD NOT WRITE\n`, actual error:

```text
File is in a directory that is denied by your permission settings.
```

Mod session `783364e2-ad00-4604-9119-7ac9d4ab3e86`: exactly one `mcp__harness-files__write_multiple_files` call on `calibrated-mod.txt`, same attempted content, actual error:

```text
Write permission deny: Permission to edit C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/fixture/calibrated-mod.txt has been denied.
```

Both processes exited 0; both tool results have `is_error: true` as expected for the refusal. Independent Node byte inspection after each process verified:

```text
before hex = after hex = 44454e494544204d55535420535441590a
before SHA-256 = after SHA-256 =
811cbdffd1500783349be98ad72503006f4523e86ae62da80df5c29cc56cc829
```

For each of `calibrated-native` and `calibrated-mod`, the new evidence area contains `*-command.json` (exact executable, argv, prompt, cwd, deny rules, initial bytes), `*.jsonl` (raw host events/results), `*.stderr.log`, and `*-verification.json` (actual tool calls/results, exit status, before/after hex and hashes, assertions). Verification output was independently inspected; no model's final claim supplies the result. These two new passes replace the invalid historical denial case; total is 10 pass, 0 fail, 0 blocked. No product edit was made or required.

## Added public installer-activation lane — 2 pass, 0 fail, 0 blocked

Previous 10 passes are unchanged. Two additional checks passed:

1. **Public installer activation:** current `kit.mjs install <fresh fixture> --enable-plugin` exited 0; real `claude plugin list` reported `harness-files@paseo-harness-kit`, version 0.1.0, scope project, enabled. The installer-generated project settings contain `enabledPlugins["harness-files@paseo-harness-kit"]: true`; isolated `plugins/installed_plugins.json` records the correct projectPath and project scope. No manual settings edits or invented markers.
2. **New session registration without direct loading:** a fresh Astra-medium session, with neither `--plugin-dir` nor `CLAUDE_CODE_PLUGIN_DIRS`, registered all three tools, reported source `harness-files@paseo-harness-kit` (not `@inline`), and completed one actual `read_ranges` call on a new fixture file without ToolSearch. Session `a396c54e-217a-46f7-b76d-af9099da7815`, exit 0; returned tag `xtt1` and exact `installed activation probe` content.

Fresh locations under the authorized external area:

```text
fixture: C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/activation-fixture
CLAUDE_CONFIG_DIR: C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/activation-config
```

Both directories were created new, with failure on preexistence. The runner records that config was initially empty. Same isolated PASEO_HOME/TMP/TEMP as prior lanes; PASEO_HARNESS_ROOT and CLAUDE_PROJECT_DIR point to the fresh fixture. Inherited auth is used only through environment; no credential copy. Real `CLAUDE_CLI=C:/Users/fish/.local/bin/claude.exe` for installer invocation.

Exact commands:

```text
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/activation.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod
node C:/Users/fish/Desktop/paseo-kit/kit.mjs install C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod/activation-fixture --enable-plugin
C:/Users/fish/.local/bin/claude.exe plugin list
node C:/Users/fish/Desktop/paseo-kit/_workspace/live-acceptance/mod/activation-session.mjs C:/Users/fish/Desktop/paseo-kit-live-tests-20261020/mod
```

The first runner invokes the next two commands in the fresh fixture cwd, installer timeout **300 seconds**, plugin-list timeout **30 seconds**. The second runner creates only `activation-probe.txt` (exclusive create) and launches the real Claude CLI in that cwd, timeout **180 seconds**, with:

```text
-p --model gpt-6-astra[1m] --effort medium
--output-format stream-json --verbose --include-hook-events
--setting-sources project --strict-mcp-config
--permission-mode dontAsk --permission-prompts none
--allowedTools Read,Bash,mcp__harness-files__read_ranges
--disallowedTools Agent,Workflow,SendMessage
-- <single-read prompt>
```

Raw evidence in the external area: `activation-command.json` (exact installer argv/environment-path metadata and initial-empty proof), `activation-install.log`, `activation-exit.json`, `activation-plugin-list.log`, `activation-session-command.json` (complete argv/prompt and absent plugin-dir env flag), `activation-session.jsonl`, `activation-session.stderr.log`, `activation-session-verification.json`. Project declaration at `activation-fixture/.claude/settings.json:79–81`; registration metadata at `activation-config/plugins/installed_plugins.json`. Those declaration/list/metadata files were independently read; session verification extracts actual init and tool-result events, not final model prose. No installer flags were worked around and no production source changed.

## Cleanup and scope

All five foreground Claude model-session processes exited normally; no background jobs, servers or Paseo child agents were created, so no archive/stop operation is owed. Session artifacts, receipts, fixture and the failed target are preserved. No production edits, specification edits, real-project edits, owner Claude/Paseo config changes, daemon reload/restart, provider changes, commits or push occurred. Only the authorized isolated areas and this report were written.
