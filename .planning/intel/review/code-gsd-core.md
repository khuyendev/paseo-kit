# Code review: GSD core (GSC)

## Verdict

REVISE — 6 BLOCKER, 6 MAJOR, 0 MINOR. The offline GSD-core suite passes (57/57 tests, no skips), and all 246 snapshot files match both their recorded LF-normalized hashes and the local upstream clone at `274f8cae13d03ad80e18959b135b0e51b33329e8`; no upstream code was executed. However, the passing tests miss broken workflow-to-STATE integration, destructive phase removal, unsafe ownership/path handling, and verification checks that can certify missing evidence. The upstream integrity checker also conflicts with project-owned agents and does not enforce its complete inventory contract. These defects need correction before relying on the kit's lifecycle gates. Only this review file was written; the full repository suite and live integrations were not run.

## Findings

### CR-GSC-01 BLOCKER correctness Workflow wave logs and force-proceed overrides are never persisted
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/state.mjs:206-223`, `ship/.agents/harness/gsd/verbs.mjs:47`; callers `ship/.agents/workflows/gsd-execute.js:431-433` and `ship/.agents/workflows/gsd-plan.js:538-542` (GSDC-10, GSDC-12; INV-38, INV-48; D-65).
- Evidence: STATE writers accept only `--text` or `--text-file`. Both shipped workflows instead send their records as stdin JSON: `{plans, verify, evidence}` for `state wave` and `{reason, issues}` for `state override`. Neither the handler nor `stateVerb` reads stdin, so these calls return exit 1 with `state wave needs --text or --text-file` / `state override needs --text or --text-file`. Both callers ignore that failure, record success in memory, and continue. In particular, force-proceed accepts outstanding checker issues without the durable owner-override record required to explain that decision after restart. The integration report marks this exact interface resolved, but the real-verb tests never exercise either stdin call.
- Fix: Implement and validate the stdin record forms used by these callers, preserving the existing text forms, or change both callers to pass a fully rendered `--text` record. In either case, require a successful verb result before recording the wave or proceeding past the checker. Add integration tests using the actual verbs that assert the persisted Wave log/Overrides contents and that a write failure stops the workflow.

### CR-GSC-02 BLOCKER correctness Removing an allegedly unstarted phase deletes discussion and research
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/phases.mjs:160-188` (GSDC-15; INV-39, INV-48).
- Evidence: `STARTED_ARTIFACTS` includes only plans, summaries, verification, UAT and outline. A phase with owner decisions in CONTEXT, a DISCUSS-CHECKPOINT, a discussion log, RESEARCH, attempts or other owner files is considered unstarted. `phase remove` then recursively deletes the entire directory at line 188. No check establishes that the requested phase is future relative to STATE. For example, selecting phase 2 in STATE, discussing/researching it, and removing phase 2 before its first PLAN destroys all that work. The current test only proves refusal once a PLAN exists.
- Fix: Before any mutation, establish that the phase is strictly future and has no started-work artifacts or unknown owner files. Refuse removal when discussion/research/checkpoint/attempt/other substantive content exists; do not recursively delete a nonempty owner directory merely because there is no PLAN. Preflight every renumbered destination too. Add tests with an active phase, CONTEXT-only and RESEARCH-only phases, and an unknown owner file, asserting byte-identical trees on refusal.

### CR-GSC-03 BLOCKER correctness Ownership checks do not identify the actual Windows write paths
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/adapter-hooks.mjs:62-89`, `ship/.agents/harness/gsd/plan-checks.mjs:229-235,259-264` (GSDC-23, GSDC-26, GSDC-27; INV-38, INV-52).
- Evidence: Ownership comparisons use case-sensitive string prefixes and raw `files_modified` equality, not normalized contained paths. Read-only probes on this Windows host returned `overlaps('src/Foo.ts','src/foo.ts') === false` and no problems from `waveOverlaps` for two wave-1 plans modifying those names. Both plans can therefore be approved for the same physical file. Separately, `covers('src','src/../secret.txt') === true`: a file outside the declared owned subtree is accepted as owned. `ownsPath` validates only the entry suffix, not the mapped result, and physical junction aliases are not considered. These checks are the shared-tree disjointness gate, not merely display formatting.
- Fix: Resolve and validate every ownership target and modified/deleted path against the code root before comparing; normalize separators and dot segments, case-fold on Windows, and reject or safely resolve symlink/junction aliases and escaping mapped forms. Apply the same canonical identity to exact-file overlap, prefix ownership, shared paths, outline checks and handoff. Add Windows case-alias and traversal fixtures that fail before any handoff is written.

### CR-GSC-04 BLOCKER security Vendoring follows untrusted references outside the clone and snapshot
- Severity: BLOCKER.
- Category: security.
- Where: `ship/.agents/harness/gsd/upstream.mjs:27-32,81-97,112-121` (GSDC-44; INV-40).
- Evidence: `extractRefs` accepts `..` path components from upstream prose. `reachable` and `vendor` join those strings directly to the clone and destination without containment checks. A read-only probe extracted `gsd-core/references/../../../outside.md`, resolving its source to `C:/scratch/outside.md` for clone `C:/scratch/clone` and its destination to `C:/project/.agents/gsd/outside.md` for the installed snapshot. Thus a referenced existing file can be read outside the untrusted clone and copied outside the snapshot, overwriting a sibling file. The symlink check also only `lstat`s the final file; a directory symlink/junction in an ancestor is followed and its regular-file descendant passes. Matching `.git/HEAD` does not make either path safe.
- Fix: Reject absolute paths and traversal components in inventory sources, extracted references and manifest keys. Check lexical and real-path containment under both roots, and reject links/reparse points in every source path component, not just the leaf. Collect and validate the entire source set before deleting/replacing the snapshot. Test traversal references and ancestor junctions/symlinks, asserting no outside read/copy and no target changes on refusal.

### CR-GSC-05 BLOCKER correctness A pattern found only in the destination falsely verifies a key link
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/artifacts.mjs:60-70` (GSDC-35; INV-35, INV-36).
- Evidence: A key link passes when its pattern matches either the source or the destination: `re.test(src) || re.test(target)`. This proves a destination symbol exists, not that the source calls/imports/connects to it. A read-only probe using `from: LICENSES/gsd-core-MIT.txt`, `to: ship/.agents/harness/gsd/yaml.mjs`, and `pattern: 'export function parseYaml'` returned exit 0, `all_verified:true`, and `status:'verified'`, despite the licence containing no connection to the module. The same false positive occurs for normal missing wiring when the pattern names a function implemented in the target.
- Fix: Evaluate the link pattern against the declared source (or a separately specified, explicit edge-evidence location), never accept a destination-only match as wiring proof. Keep target existence/substance separate. Add a fixture with a real target implementation and an unrelated source; it must return `not_found` and a negative verdict.

### CR-GSC-06 BLOCKER correctness An empty or malformed UAT file is reported as passed
- Severity: BLOCKER.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/phases.mjs:271-302` (GSDC-16; INV-36, INV-53).
- Evidence: `parseUat` returns an empty list when there are no exactly matching `### N. ...` headings. `uatPassed` only rejects absence of a UAT filename; it never rejects a present file with zero parsed tests. An empty `01-UAT.md`, or a draft containing only frontmatter and `## Tests`, therefore produces `checks:[]`, `blockers:[]`, `passed:true`, exit 0. Malformed headings can similarly hide pending tests. This is a successful human-verification verdict with no checks performed; the existing test covers three well-formed blocked tests only.
- Fix: Validate the UAT document and require at least one recognized test for a passing verdict. Treat empty, truncated, malformed or unparseable test sections as explicit blockers; do not discard them. Add empty/draft/malformed-heading cases and prove none can advance via a passed UAT predicate.

### CR-GSC-07 MAJOR correctness The generated verifier's artifact-check commands are not supported by the dispatcher
- Severity: MAJOR.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/verbs.mjs:103-104`; `ship/.agents/agents/gsd-verifier.md:253-261,331-339` (GSDC-35, GSDC-45; D-111).
- Evidence: The shipped verifier explicitly invokes `verify.artifacts "$PLAN_PATH"` and `verify.key-links "$PLAN_PATH"`. Both handlers instead send the first argument to `phaseOf`, which only resolves phase numbers or immediate phase directories. Every ordinary PLAN file argument is rejected as `phase not found` with exit 66. The same verifier text interprets 66 as no declared artifacts/links, so this mismatch can turn a check that never examined the plan into a not-applicable check. Unlike `verify.plan-structure`, whose file-path form was repaired during integration, these two verb forms were not reconciled. Tests call them with phase `1` only.
- Fix: Support the actual PLAN-file forms, including quick plans, and derive the surrounding phase/all-plan context needed for pending links. Distinguish a missing/unreadable PLAN (could not look) from a valid PLAN declaring no artifacts. Align the response fields consumed by the verifier through the adapter layer or compatibility aliases, without editing upstream bodies. Add real-entry tests executing the exact commands in the generated role against a broken artifact/link.

### CR-GSC-08 MAJOR spec Upstream check rejects legitimate project-owned agents
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/gsd/upstream.mjs:292-304` (GSDC-47, GSDC-53; D-109, D-110; INTERFACES section 4.1).
- Evidence: `check` recursively treats every file in `.agents/agents` as kit-owned method text and fails if it is absent from the shipped inventory. A project adapter is explicitly allowed to add its own agents in that directory. A read-only simulation adding `project-architect.md` to the directory listing produced the sole problem `installed GSD method file not in the inventory: .agents/agents/project-architect.md`. A normal adapter-generation outcome therefore makes `upstream check`, and the corresponding `ph doctor` check, fail even with the upstream snapshot and every generated role intact. Requiring projects to modify a kit-owned inventory is not the adapter contract.
- Fix: Restrict inventory-completeness enforcement to kit-owned method units/known generated namespaces, while allowing project-owned agent files beside them. Preserve detection of unexpected files in the exclusively generated directory. Add an installed-project fixture with an adapter-mapped custom agent; integrity checking must pass without edits to the kit inventory.

### CR-GSC-09 MAJOR spec Inventory validation omits skill wrappers and does not detect missing overlays
- Severity: MAJOR.
- Category: spec.
- Where: `ship/.agents/harness/gsd/upstream.mjs:223-224,287-305`; `ship/.agents/gsd/inventory.json:512-652`; `tests/gsd-core/upstream.test.mjs:227-243` (GSDC-47, GSDC-53).
- Evidence: The inventory does not list the shipped `.claude/skills/gsd-*/SKILL.md` wrappers or the workflow scripts/common overlay/lenses, apart from three role overlays. The test asserts the expected generated workflow names and existence of listed entries, not that all installed method files are listed. At runtime, `generate` skips `kit-authored` entries, and `check` checks only generated-file existence plus files it discovers on disk. Deleting a listed kit overlay such as `.agents/gsd/overlays/kit-core.md` therefore produces no missing-overlay problem: it is neither generated nor discovered. That file supplies the single-writer/no-worker-commit/runtime mapping rules, and its absence subsequently prevents role loading rather than being diagnosed by the integrity gate.
- Fix: Inventory all kit-authored wrappers, scripts and overlays required by GSDC-53. Check existence and type for every required inventory entry and every generated agent include/overlay reference, independently of whether it is generated. Make completeness tests enumerate the kit's method-file set in both directions, and add deletion tests for kit-core and role overlays. Continue to allow overlay content changes and project-owned additions without changing protected upstream text.

### CR-GSC-10 MAJOR security YAML mappings silently overwrite duplicates and interpret prototype keys
- Severity: MAJOR.
- Category: security.
- Where: `ship/.agents/harness/gsd/yaml.mjs:116-132,214-230`; consumers `ship/.agents/harness/gsd/plan-checks.mjs:35` and `ship/.agents/harness/gsd/status.mjs:59-69` (GSDC-05; INV-35, INV-36).
- Evidence: Block maps reject duplicate own keys, but flow maps assign without checking duplicates. A probe of `x: {status: passed, status: gaps_found}` returned a successful parse with only the last status retained. Both parsers construct ordinary `{}` objects and assign `__proto__` normally: parsing `__proto__: {status: passed}\nphase: one` returned JSON containing only `phase`, but the resulting object's inherited `status` was `passed`. This is local prototype manipulation, not a claim of global prototype pollution. Consumers use inherited lookup (`fm.status`) and the `in` operator for required fields, so malformed data can supply fields absent from the actual serialized mapping. The parser's promised no-silent-drop/error-with-line contract is not met.
- Fix: Use prototype-safe mapping construction or reject dangerous keys explicitly, apply duplicate-key checks to flow maps as well as block maps, and require own properties in schema checks. Add nested flow/block prototype-key and duplicate-key cases that return a named line error (or preserve harmless keys as own data under an explicitly chosen policy), never inherited lifecycle metadata.

### CR-GSC-11 MAJOR invariant Revision hashes omit part of the effective researcher role
- Severity: MAJOR.
- Category: invariant.
- Where: `ship/.agents/harness/gsd/revisions.mjs:13,24-37`; `ship/.agents/agents/gsd-phase-researcher.md:6-9` (GSDC-28, GSDC-32; INV-22, INV-39).
- Evidence: Research revisions hash a fixed list of the agent definition and two GSD overlays. The shipped role now also includes `.agents/workflows/overlays/gsd-phase-researcher.md`, but the revision list does not include that file. Editing that active include changes the instructions used by the researcher without changing `revisions hash research`, `inputs`, or dependent freeze/plan hashes. The generated definition's hash covers only the unchanged include pathname, not the included bytes. A previously accepted report can still be classified `complete` and reused under the old instructions. The existing revision test changes CONTEXT/specs/ROADMAP, never an effective role include.
- Fix: Derive role-text inputs from the same resolved definition/includes used for prompt assembly, rather than a hard-coded file list. Keep the invoking-checkout root rule for harness text. Add a test editing the currently shipped flow overlay (and a newly added include) after recording research; the digest and dependent revisions must change and the old report must become stale.

### CR-GSC-12 MAJOR correctness Test-command normalization changes commands it does not recognize
- Severity: MAJOR.
- Category: correctness.
- Where: `ship/.agents/harness/gsd/tools.mjs:25-38` (GSDC-41; INV-52, INV-53).
- Evidence: The `--watch` removal regex applies to every command, and the final whitespace collapse applies inside quoted arguments. Read-only probes returned `node test.mjs` for `node test.mjs --watch=false`, and changed `node -e "console.log('a  b')"` into `node -e "console.log('a b')"`. The requirement says unknown commands remain unchanged; here the helper can change the tested input, corrupt paths with repeated spaces, or remove an explicit one-shot option from a project-specific runner. The tests only check bare vitest, Jest watch and a simple pytest command, so they do not establish preservation.
- Fix: Limit transformations to recognized runner invocations and manipulate argument tokens without changing quoted values or unrelated options. Preserve the exact original string when no recognized rule applies. Add unknown-runner, `--watch=false`, quoted-path and quoted-program-text cases; only documented watch-mode rewrites may differ.
