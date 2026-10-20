# Code review: install (INS)

## Verdict

REVISE — 2 BLOCKER, 3 MAJOR, 0 MINOR. The ordinary install/update/pull ownership paths are well covered, and the offline installer suite passed all 49 tests (`node --test "tests/install/*.test.mjs"`, Windows). However, manifest paths can escape the project and authorize deletion, and destination junctions can redirect installation into owner configuration or another project. The documented older-kit upgrade also fails on its existing ignore block, retiring a hook leaves its registration pointing at a deleted file, and the byte-digest requirement is not implemented or meaningfully tested. The probes below were read-only/in-memory; no live project or owner configuration was modified.

## Findings

### CR-INS-01 BLOCKER security Manifest keys authorize deletion outside the project

- Severity: BLOCKER.
- Category: security.
- Where: `kit/install/manifest.mjs:17-19`, `kit/install/parts.mjs:13`, `kit/install/parts.mjs:59-63`, `kit/install/verbs.mjs:55-73` (INST-05, INST-07, INST-31; INV-03).
- Evidence: `isCurrentFormat()` validates digest values but never validates the paths in `files`. Every manifest key is subsequently included in `update`, and `projectFileOf()` simply joins it to the project root. A current-format manifest containing `{"version":"0.0.1","files":{"../outside/victim.txt":"<digest of known victim contents>"}}` is accepted. Because that key is not shipped, an existing matching file is classified `removed` and passed to `fs.rmSync()` without `--force`. The read-only probe confirmed both acceptance and resolution of `C:/scratch/project` plus that key to `C:/scratch/outside/victim.txt`. The analogous block key can rewrite an external marked document. A checked-in or corrupted ownership record must not grant deletion authority outside the selected project.
- Fix: Validate every manifest key before any unit is processed: require a normalized, nonempty forward-slash relative path, reject traversal, absolute/drive/UNC paths, backslashes and ambiguous segments, and validate the file portion of block keys separately. Resolve destinations through a containment-enforcing helper rather than a raw join. Reject the whole invalid record before copying or deleting anything. Add tests for traversal in both retired file and block keys, asserting no project or external-tree changes.

### CR-INS-02 BLOCKER security Installation follows destination junctions into owner files

- Severity: BLOCKER.
- Category: security.
- Where: `kit/install/index.mjs:36-42`, `kit/install/parts.mjs:23-26`, `kit/install/parts.mjs:38-47`, `kit/install/wiring.mjs:13-45`, `kit/install/hooks.mjs:38-53` (INST-02, INST-22, INST-24, INST-25; INV-01, INV-09, INV-52).
- Evidence: Target refusal checks only the project's root realpath. Unit reads use `statSync()` and writes use `mkdirSync()`/`writeFileSync()`, following symlinks and Windows junctions at every descendant. The wiring paths have the same unchecked ancestors. For example, a normal project whose `.claude` is an owner-selected junction to a user Claude config directory passes target validation; plain `install` creates missing skills/hooks there and reconciles that user directory's `settings.json`, even without `--enable-plugin`. A junction at `.claude/skills/harness` can similarly redirect copies into another project or the kit source. `--force` can then truncate differing external files. The root-level realpath check does not protect any of these targets.
- Fix: Before mutation, inspect every destination and existing ancestor with `lstat`/canonical-path checks, including settings, seeds, marked documents and the manifest. Refuse or report an owner-link conflict rather than following a linked destination tree; `--force` must not bypass it. Apply the corresponding protection to pull destinations in the kit. Add Windows junction and POSIX symlink fixtures covering `.claude`, a skill folder and a file link, and assert the external tree is byte-identical with and without `--force`.

### CR-INS-03 MAJOR correctness The documented fresh-install upgrade rejects the old valid ignore block

- Severity: MAJOR.
- Category: correctness.
- Where: `kit/install/text.mjs:6-7`, `kit/install/text.mjs:53-58`, `tests/install/ownership.test.mjs:11-44` (INST-19, INST-28, INST-31).
- Evidence: The new parser recognizes only an exact START line, but retains the old END line. The actual `ref-final` installer wrote `# >>> paseo-harness-kit: generated paths, kept by install.mjs and ph skills-sync (edit outside this block)` and `# <<< paseo-harness-kit`. Passing that well-formed CRLF block to `putGitignoreBlock()` throws `.gitignore has broken "# >>> paseo-harness-kit: generated paths (edit outside this block)" markers; fix them by hand`. Thus moving the older manifest aside and running `install`, exactly as documented, copies files and reaches wiring but fails before writing the new manifest. The INST-31 fixture omits the old `.gitignore`, so it does not catch this ordinary upgrade input.
- Fix: Recognize a kit ignore START by its stable marker prefix, independently of the explanatory suffix, while continuing to reject duplicate or genuinely malformed markers. Replace only the identified kit block and preserve all outside bytes/EOLs. This can be a general marker rule, not a legacy-manifest migration. Extend the older-kit fresh-install test with the exact `ref-final` ignore block and verify completion, one resulting block and unchanged owner lines.

### CR-INS-04 MAJOR correctness Retiring a hook deletes its script but leaves active registrations

- Severity: MAJOR.
- Category: correctness.
- Where: `kit/install/hooks.mjs:13-15`, `kit/install/hooks.mjs:37-51`, `kit/install/verbs.mjs:70-80` (INST-07, INST-14, INST-18).
- Evidence: Update deletes unchanged retired files before wiring. Hook reconciliation derives its entire managed set from the **new** template. If a release removes or renames a registered hook and removes its old template entry, that script is deleted as `removed`, but its existing settings registrations are no longer recognized as managed and are preserved. Update can exit 0 with `0 kept` while subsequent tool calls invoke a nonexistent module. An in-memory probe confirmed that reconciling a `PreToolUse` registration for `old_guard.mjs` against an empty new hook template leaves the registration unchanged; the unchanged retired script is independently classified `removed`. Existing retirement tests cover ordinary files and blocks, not registered hooks.
- Fix: Carry the set of previously owned hook scripts actually proven unchanged and retired by this update into reconciliation. Remove registrations for those retired scripts as well as reconciling the current template; do not remove registrations for locally modified retired scripts or unrelated owner hooks. Add an end-to-end fixture that installs a hook, removes it from both the kit units and template, updates, and asserts no dangling registration, with companion cases for an edited retired script and an unrelated hook sharing its group.

### CR-INS-05 MAJOR spec Ownership hashes lose non-UTF-8 bytes and the test is tautological

- Severity: MAJOR.
- Category: spec.
- Where: `tests/install/units.test.mjs:44-51`, `kit/install/units.mjs:104`, `kit/install/parts.mjs:23-29`; shared implementation: `ship/.agents/harness/lib/hash.mjs:7-9` (INST-04; INV-01, INV-02).
- Evidence: INST-04 requires SHA-256 over bytes with only CRLF normalized. Instead `fileDigest()` decodes as UTF-8, and `textDigest()` converts its input to a string before hashing. Different invalid byte sequences become the same replacement character. A read-only probe confirmed `textDigest(Buffer.from([0xff])) === textDigest(Buffer.from([0xfe]))`, although their byte SHA-256 values differ. Consequently byte changes can be treated as `same` or as an unchanged retired file, defeating the ownership check. The purported non-UTF-8 assertion compares `fileDigest(file)` with itself, so it cannot detect this loss of information. The shipped files currently being text does not fulfill the explicit byte contract.
- Fix: In coordination with the shared-helper owner, normalize CRLF at the byte level and hash the resulting buffer; encode string/block inputs as UTF-8 before that same helper. Keep digest consumers consistent, including mod integrity checks. Replace the self-equality assertion with known byte-SHA expectations, distinct invalid-UTF-8 inputs and binary CRLF/LF pairs; add a lifecycle test proving a changed invalid-byte file is kept rather than silently classified unchanged or deleted.
