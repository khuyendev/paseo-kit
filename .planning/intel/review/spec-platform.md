# Spec review: PLT

## Verdict
REVISE; 3 BLOCKER, 13 MAJOR, 1 MINOR.

All 85 behavior IDs absorbed by M1–M3 appear in the traceability table, along with the six explicitly identified dropped skill-link behaviors. The seven “not a requirement” dispositions are justified by D-10/S-02 and S-16. Coverage is therefore structurally complete, but some claimed contracts are incomplete or contradictory. The most consequential defects are a v1 legacy-manifest conversion contrary to D-01, link ownership inferred from a pathname suffix, executable concrete-model defaults contrary to D-16, and installation/configuration interfaces that cannot consistently satisfy their own acceptance checks. No project/engine/game content or direct method-text rewrite was found in this area; the D-111 restoration of ai-orchestrator is correctly delegated to M11 rather than dropped here. Review used the brief, synthesis, decisions including D-109–111, ingest conflicts, phases draft, all five absorbed maps, owner memories, and relevant runtime/tools/method interface requirements. No commands from the old kit or live configuration operations were run.

## Findings

### SR-PLT-01 MAJOR coverage Secret export preserves the known short-value failure
- Severity: MAJOR.
- Category: coverage.
- Target: MACH-13; INS-44.
- Evidence: INS-44 explicitly changes export to “do not rely on value substring for very short values”; install concern C-10 explains the false failure. MACH-13 instead replaces every occurrence and rejects any remaining substring, with only a long-token acceptance fixture. A secret such as `a` can corrupt ordinary strings or make every export fail on JSON property names and placeholder text.
- Fix: Specify structural replacement of secret-valued env fields and a boundary-aware policy for incidental strings/URL hosts that does not globally substitute short values. Add short-value and overlapping-secret fixtures proving valid exported JSON, intact nonsecret fields, placeholders in secret fields, and no raw credential leakage. Update the INS-44 trace to include this check.

### SR-PLT-02 MAJOR coverage Kept conflicts have no required manifest baseline preservation
- Severity: MAJOR.
- Category: coverage.
- Target: INST-09, INST-11, INST-05; INS-10, INS-12.
- Evidence: INS-06/INV-02 require three distinct digests. INST-09 says when to record K and drop a key, but says only to print a line for kept `local`/`both`/`removed-local`; INST-11 likewise omits the record policy for unselected or skipped parts. Rebuilding the manifest from just the explicitly recorded parts loses I and changes later ownership decisions. Recording P for a kept edit is worse: it can authorize a later overwrite without force.
- Fix: Require preservation of the previous I for every retained or unselected recorded unit; an unrecorded install conflict must remain unrecorded until explicitly taken. Drop records only for the stated gone/deleted cases and advance them only for successful copies or `same`. Test two consecutive updates and a selective pull with unrelated local/both/removed-local parts, asserting both manifest values and unchanged classifications.

### SR-PLT-03 MAJOR testability Portability acceptance never exercises the integrity-gated runtime
- Severity: MAJOR.
- Category: testability.
- Target: INST-25.
- Evidence: INV-09, INS-55 and HIS-31 require the installed project to carry everything it runs on. Acceptance only runs `ph config` and an unspecified hook; a hook can exit 0 on a missing runtime/config error under INV-26. Neither checks file-backend discovery/integrity, GSD imports, or project-side provider checks needed by doctor.
- Fix: With the source kit unavailable, run offline fixtures for `ph config`, `ph doctor` with fake external dependencies, a hook with an expected nonempty result and no unavailable diagnostic, a file-backend request through discovery/manifest validation, and a GSD read verb. Assert expected outputs rather than exit 0 alone, and assert no attempted read under the missing kit root.

### SR-PLT-04 MAJOR testability Node support is not a specified gate
- Severity: MAJOR.
- Category: testability.
- Target: INST-23, MACH-03, MACH-07.
- Evidence: INS-29/RUN-60 and SYNTHESIS M1 require an actual runtime gate. INST-23 says “minimum Node major” and “every non-baseline API” without naming the major, defining baseline, listing capabilities, or naming a check that determines them. The acceptance says to stub versions/APIs but supplies no expected supported/unsupported boundary.
- Fix: State the supported minimum Node version and capability list once, or name a release qualification check whose recorded output supplies these values before implementation. Add boundary tests for the minimum, one lower version, and each missing required capability; distinguish the runtime floor from the test-runner floor. Reference that contract from machine and doctor.

### SR-PLT-05 BLOCKER decision A legacy update conversion replaces the decided fresh-install upgrade
- Severity: BLOCKER.
- Category: decision.
- Target: INST-27, INST-08, Later.
- Evidence: D-01 (as narrowed by D-110) explicitly says no migration code in v1, upgrade through installing the new kit, generic adoption LATER. INST-27 requires recognition and conversion of old 16-hex records and the old `kit` field during `update`, then labels this “no migration code.” INST-08 refuses install whenever that old manifest exists. The promised new manifest also cannot retain old conflict baselines under its 64-hex-only rule without either dropping provenance or blessing local bytes.
- Fix: Remove INST-27's v1 old-format conversion. Specify a documented owner-controlled fresh-install preparation that preserves the old record as project evidence, or a clear unsupported-old-manifest refusal directing to that preparation; do not automatically reinterpret or rewrite old ownership records. Test that old manifests/files remain untouched by unsupported update and that the documented fresh-install path surfaces differing files as conflicts. Keep generic adoption solely in Later.

### SR-PLT-06 BLOCKER decision A matching suffix is not proof that a user-skill link is kit-owned
- Severity: BLOCKER.
- Category: decision.
- Target: MACH-16.
- Evidence: INV-03 and D-07 require removing/repointing only kit-made links and never touching an owner's entry. MACH-16 calls any link targeting a path ending in `user/skills/kit-init` kit-made. An owner-created link to a separate checkout with precisely that normal layout satisfies the test and can be replaced or deleted.
- Fix: Require durable proof of a link created by this machinery (recorded source target and destination, with the current link still matching that record) before replacement/removal. Preserve unrecorded links even when their suffix matches. Add fixtures for an owner-created matching-suffix link, a recorded link the owner repointed, and a genuine old recorded kit link; only the last may be rebound/unlinked. Preserve the previous link if replacement fails.

### SR-PLT-07 BLOCKER decision Calling concrete model defaults examples does not make them non-defaults
- Severity: BLOCKER.
- Category: decision.
- Target: CONF-11 (also coordinate PHCL-22).
- Evidence: D-16 says “no concrete model id is a kit default except template examples”; HIS-74 and R-10 explain quota-driven model selection. CONF-11 requires three executable default tier mappings to concrete `circle/<model>` IDs and tries to exempt them by labeling them examples in `_notes`. `default_tier: standard` makes these operational without any project choice. Runtime PHCL-22 repeats the tier-table exception, which is not the exception D-16 grants.
- Fix: Keep concrete IDs in the owner-confirmed provider catalogue/examples, not active kit tier defaults. Define a validation-compatible unconfigured tier state and a named setup/adapter step that establishes usable project mappings before dispatch; spawning without a configured mapping must fail with an actionable diagnostic. Test that changing the project's mappings requires no kit/script edit and that an untouched install cannot silently choose a concrete kit model.

### SR-PLT-08 MAJOR consistency Hook reconcile and mod activation do not identify the prospective manifest
- Severity: MAJOR.
- Category: consistency.
- Target: INST-14, INST-18, INST-20.
- Evidence: INS-20/25/27 and HOK-02 require clean installs and updates to wire hooks/mod before writing the manifest. INST-14 blocks any hook not recorded or differing from “the manifest”; INST-20 requires assets equal their recorded digest. On fresh install there is no disk manifest; on update a successfully copied new version differs from the old record. Literal implementations block all fresh hooks/mod activation and clean upgraded hooks.
- Fix: Explicitly distinguish the previous disk manifest from an in-memory prospective ownership record. Reconcile/activation must use the latter for successfully copied or same units while preserving old ownership evidence for kept conflicts. Add fresh install with enable-plugin, clean kit-version update, forced replacement, and retry-after-wiring-failure tests proving correctly copied hooks are registered and verified before the new manifest is persisted.

### SR-PLT-09 MAJOR consistency Edited block is forced to local even when both sides changed
- Severity: MAJOR.
- Category: consistency.
- Target: INST-13 versus INST-06, INST-09, INST-11.
- Evidence: INS-06 states P != K, P != I, K != I means `both`. INST-13 covers a block differing from kit and installed bodies and unconditionally says update keeps it “as local.” This includes `both`, whose pull safety requires `--force`; it also leaves the D-05 warning rule incomplete for a differing unrecorded block.
- Fix: State that the warning does not alter the three-digest state or overwrite/pull rules. Specify the warning condition independently (project block differs from shipped block), and add local, both, and unrecorded differing block tests. A both-changed block must still require force to pull.

### SR-PLT-10 MAJOR consistency Worker-clone acceptance demands removal of an owner rule
- Severity: MAJOR.
- Category: consistency.
- Target: MACH-09 acceptance; MACH-08.
- Evidence: INS-51 requires a missing worker to deep-copy the live source “as the owner left it,” then union worker policy, then patch the main. MACH-09's fixture says a tool already in the main's list but absent from the worker list must be absent from the freshly cloned worker. Deep copying requires the opposite and INV-07 forbids removing that owner rule.
- Fix: Split the fixture: an owner-only rule already on the live main must be inherited by a new worker; a main-only kit policy entry added later during this apply must not be inherited unless independently required by worker policy. Use fixture policy values that distinguish those two cases and assert mains-after-workers ordering.

### SR-PLT-11 MAJOR consistency Export cannot regenerate the required provider template
- Severity: MAJOR.
- Category: consistency.
- Target: MACH-13 versus MACH-14.
- Evidence: D-08 requires re-exporting the shipped catalogue. MACH-13 writes worker `disallowedTools` and preserves live main denies plus the kit list. MACH-14 requires no stored worker `disallowedTools` and an exactly `[Agent, Workflow]` main list. A conforming export always violates the worker shape and violates the main shape whenever the owner has an extra deny.
- Fix: Define one canonical export/template policy representation. Prefer omitting derived worker policy from stored template data and rendering it from defaults, while explicitly deciding how owner main extras are represented without becoming mandatory kit policy. Require export -> parse/render -> apply/check round-trip fixtures, including main extras, and make the release template pass that same schema without hand editing.

### SR-PLT-12 MAJOR consistency Config keeps the retired MCP read ceiling
- Severity: MAJOR.
- Category: consistency.
- Target: CONF-06, CONF-11 versus FTOL-23.
- Evidence: D-41/FIL-26 replace MCP-sized limits with one-page mod reads. CONF-06 accepts `replyMaxChars < 500000`; FTOL-23 requires rejecting values above 40000 and specifies defaults 36000/38000. CONF-11 provides only “about 40,000” and a golden table chosen by the implementer. An overlay such as 200000/450000 passes the platform rule but violates the consumer contract.
- Fix: Make FTOL-23's two keys, exact defaults and page-size bound authoritative in CONF-06/11, removing the 500000 legacy ceiling. Add cross-module acceptance that the same oversized overlay is rejected by ph, hooks and the backend, and that a near-limit successful read needs no continuation.

### SR-PLT-13 MAJOR consistency Closed schema lacks names and merge semantics required by runtime
- Severity: MAJOR.
- Category: consistency.
- Target: CONF-04, CONF-06, CONF-11; PHCL-24, PHCL-29, FLOW-28, FLOW-38.
- Evidence: RUN-10/63 and P3 require one complete closed config contract. Platform leaves the live-cap key and watchdog switch unnamed, omits `warmup_s`/`warmup_timeout_s`, and says every non-map key replaces wholesale. Runtime specifies `max_live_subagents: 40` (>= max_subagents), `watchdog_enabled: true`, warmup values 8/90, and a kit base note plus an appended project note. No project-note key or special two-layer retrieval is defined; replacing `first_prompt_note` discards the safety text PHCL-29 requires.
- Fix: Publish the complete top-level key/type/default table, including these consumer keys and relationships. Define a distinct project-note key or an explicit API returning base and overlay notes independently, with a default and validation rule; do not make consumers bypass the loader. Add one integration fixture exercising all four runtime features through the closed loader and proving project notes cannot replace the kit base.

### SR-PLT-14 MAJOR consistency Planning seed reference names a tree but not an installable seed set
- Severity: MAJOR.
- Category: consistency.
- Target: INST-17; interface with GSDC-01 and the new-project flow.
- Evidence: INS-24/59, SYNTHESIS M1 and D-109 require install-time planning seeds before map-codebase/harness/new-project. INST-17 delegates to “the .planning/ seed set defined by the GSDC requirements”; the checked GSDC-01 defines allowed paths, not which files install creates or their initial contents. Seeding empty PROJECT/REQUIREMENTS/ROADMAP files can incorrectly make an existence-based new-project resume skip essential stages.
- Fix: Name the exact seed files/directories and their validity/initialization markers in one GSDC contract referenced by ID from INST-17. Distinguish an install seed from a completed lifecycle artifact in new-project resume checks. Add install -> map-codebase/adapter -> new-project offline routing acceptance proving placeholders do not skip questioning or required document generation and all existing project artifacts remain untouched.

### SR-PLT-15 MAJOR consistency kit-init root traversal stops in user rather than the kit
- Severity: MAJOR.
- Category: consistency.
- Target: INST-30.
- Evidence: The declared path is `<kit>/user/skills/kit-init/`. Two parent traversals from that skill folder yield `<kit>/user`, not `<kit>`, so the subsequent `kit.mjs`/`kit.json` check fails for the required installation layout. INS-56's ambiguous old wording was copied rather than reconciled with the new path.
- Fix: Resolve the real path of SKILL.md and go three directory levels above its containing `kit-init` folder, or walk ancestors to the explicitly validated kit marker pair. State the starting object unambiguously. Add a deterministic filesystem test through both a Windows junction and a POSIX directory symlink; do not rely only on a skill-text lint/live smoke.

### SR-PLT-16 MAJOR consistency A JSON helper is required to parse non-JSON freeze records
- Severity: MAJOR.
- Category: consistency.
- Target: CONF-02.
- Evidence: RUN-54 defines `freeze_*.sha256` as shasum-compatible text lines, not JSON. CONF-02 explicitly includes freeze records in the records read by `readJson`. The runtime BOM concern asks for BOM handling, not conversion of that text format.
- Fix: Remove freeze records from the JSON-reader list; specify a shared BOM-aware text read for freeze records and JSON parsing layered on it where appropriate. Preserve RUN-54's format and test BOM-prefixed freeze files separately from BOM-prefixed JSON records. Narrow the lint so it enforces consistent JSON reads without forcing text/JSONL formats through a whole-file JSON parser.

### SR-PLT-17 MINOR consistency Blanket no-link and no-user-config wording lacks authorized exceptions
- Severity: MINOR.
- Category: consistency.
- Target: INST-24, INST-22 versus MACH-16, INST-20/21.
- Evidence: D-10 removes project skill links, not D-07's explicitly requested user-level bootstrap link. INST-24 says “the kit creates no junction or symlink” globally. INST-22 says force never touches any user-scope Claude config, whereas explicitly requested plugin installation can register a marketplace there through Claude's own CLI.
- Fix: Scope the no-link promise to installed project skill trees and name MACH-16 as the user-bootstrap exception. Clarify that force grants no extra permission to modify user config, while explicit enable-plugin still invokes the supported CLI under the intended config dir. No new mechanism is needed.

## Traceability rows checked

All 91 rows were checked against the named map behavior and its superseding decisions. “Wrong” includes an incomplete claimed contract, not merely an absent ID. Shared behavior rows are checked once. A row marked ok does not independently certify every acceptance assertion in its target requirement.

| behavior ID | requirement claimed | ok / wrong (why) |
| --- | --- | --- |
| INS-01 | INST-01 | ok — verbs, argument failures and 0/1/2 contract retained. |
| INS-02 | INST-01, INST-02 | ok — platform line and target refusal retained; sibling-prefix bug corrected. |
| INS-03 | INST-03 | ok — listed files, block units and test exclusions. |
| INS-04 | INST-04 | ok — shared longer CRLF-insensitive digest. |
| INS-05 | INST-05, INST-27 | wrong — new manifest is covered, but INST-27 adds legacy conversion contrary to D-01 (SR-PLT-05). |
| INS-06 | INST-06 | ok — full P/K/I classifier is present. |
| INS-07 | INST-07 | ok — retired files and, per D-11, blocks removed only when unchanged. |
| INS-08 | INST-08 | ok — conflicts do not prevent writing the new install record; legacy entry-path conflict noted in SR-PLT-05. |
| INS-09 | INST-08 | ok — unrecorded conflict becomes both on the next update. |
| INS-10 | INST-09 | wrong — kept-unit baseline retention is unspecified (SR-PLT-02). |
| INS-11 | INST-10 | ok — read-only differing-unit report and both version labels. |
| INS-12 | INST-11 | wrong — selective/skipped pull record retention is unspecified (SR-PLT-02). |
| INS-13 | INST-11, INST-28 | ok — multiple parts and unknown-part error follow D-14. |
| INS-14 | INST-12 | ok — marked-block replacement, insertion, surrounding text and EOL. |
| INS-15 | INST-13 | wrong — warning is present but forces both-changed blocks to local (SR-PLT-09). |
| INS-16 | INST-26 | ok — dropped Backlog init represented as tested absence. |
| INS-17 | INST-26 | ok — dropped Backlog block represented as tested absence. |
| INS-18 | INST-26; later adopt | ok — old relocation dropped, generic adopt deferred; separate INST-27 contradicts that disposition (SR-PLT-05). |
| INS-19 | INST-26 | ok — legacy config migration dropped. |
| INS-20 | INST-14 | wrong — prospective ownership record is not identified for hook reconcile (SR-PLT-08). |
| INS-21 | INST-15 | ok — template ownership and modern matchers delegated to HOOK. |
| INS-22 | INST-14, INST-15 | ok — project/kit hook coexistence and retired stub exclusion covered. |
| INS-23 | INST-16 | ok — import insertion, EOL and idempotence preserved. |
| INS-24 | INST-17, CONF-07 | ok — overlay/history seed-once and D-60/D-77 changes covered; added planning seed interface remains unresolved (SR-PLT-14). |
| INS-25 | INST-18 | wrong — ordering is retained but ownership checks cannot use the disk manifest during that ordering (SR-PLT-08). |
| INS-26 | INST-24 | ok — sync call dropped by D-10 rather than carried as a child process. |
| INS-27 | INST-20 | wrong — explicit activation/gates retained, but pre-persistence digest source unspecified (SR-PLT-08). |
| INS-28 | INST-21 | ok — identical marketplace reuse, differing registration preserved. |
| INS-29 | INST-20, INST-23, MACH-07 | wrong — actual Node support boundary unspecified (SR-PLT-04). |
| INS-30 | not a requirement: D-10/S-02; INST-24 | ok — project dual skill tree explicitly dropped. |
| INS-31 | not a requirement: D-10/S-02; INST-24 | ok — project skill-link record dropped with dual tree; user links still need ownership proof (SR-PLT-06). |
| INS-32 | not a requirement: D-10/S-02; INST-24 | ok — mirror/link conversion dropped. |
| INS-33 | not a requirement: D-10/S-02; INST-24 | ok — project link replacement mechanism dropped. |
| INS-34 | not a requirement: D-10/S-02; INST-24 | ok — stale project link removal dropped. |
| INS-35 | not a requirement: D-10/S-02; INST-24 | ok — project junction rebinding dropped. |
| INS-36 | INST-19 | ok — generated-path block, EOL, owner text, idempotence. |
| INS-37 | MACH-01 | ok — surviving machine verbs/flags and argument errors. |
| INS-38 | MACH-02, MACH-03 | ok — read-only diagnostics, no model calls or daemon starts; D-07/D-15 notes added. |
| INS-39 | MACH-07, MACH-11, MACH-12 | ok — gates, backup, atomic write, reload/check; policy-only changes now backed up. |
| INS-40 | MACH-11 | ok — timestamp collision handling and atomic config write. |
| INS-41 | MACH-08 | ok — additive provider/model entries, existing credentials preserved. |
| INS-42 | MACH-06, MACH-09 | ok — policy rendering and D-06 corrected deny lists covered. |
| INS-43 | MACH-10 | ok — placeholders, explicit precedence and endpoint-matched token reuse. |
| INS-44 | MACH-13 | wrong — short-secret fix omitted and output conflicts with MACH-14 (SR-PLT-01/11). |
| INS-45 | MACH-14 | wrong — owner confirmation retained, but required shape cannot be regenerated by MACH-13 (SR-PLT-11). |
| INS-46 | MACH-19, MACH-03 | ok — MCP management dropped per D-03, manual removal documentation retained. |
| INS-47 | MACH-15 | ok — explicit plugin enabling, project-independent panels, preserve conflicting owner entry. |
| INS-48 | MACH-03 | ok — Backlog check dropped and absence tested. |
| INS-49 | MACH-04 | ok — missing worker/env/deny diagnostics and owner extras; legacy fingerprint branches dropped. |
| INS-50 | MACH-05 | ok — main policy check corrected by D-06, no SendMessage requirement. |
| INS-51 | MACH-08, MACH-09 | wrong — acceptance contradicts clone-from-live-main and owner-rule preservation (SR-PLT-10). |
| INS-52 | not a requirement: S-16 | ok — 0.0.2 fingerprint retirement deliberately dropped. |
| INS-53 | MACH-12 | ok — CLI reload only, failure after write is exit 2 per D-09. |
| INS-54 | MACH-01 | ok — shim dropped; explicit apply and read-only check kept. |
| INS-55 | INST-25 | wrong — portability requirement exists but acceptance does not prove all promised consumers (SR-PLT-03). |
| INS-56 | INST-30, MACH-16 | wrong — root traversal fails and link ownership is unsafe (SR-PLT-06/15). |
| INS-57 | INST-29 | ok — offline temp homes, fakes, spaces, no live configuration. |
| INS-58 | INST-28 | ok — ownership/docs and install-versus-machine distinction retained. |
| INS-59 | INST-24, INST-25 | ok — tracked/project-owned split retained; added GSD seeds need exact contract (SR-PLT-14). |
| INS-60 | INST-22, INST-28 | ok — force restrictions retained; scope wording needs plugin exception clarification (SR-PLT-17). |
| INS-61 | INST-15 | ok — project-generated hook replaced by generic shell per D-45; checker behavior delegated to HOOK/ADPT. |
| INS-62 | MACH-17 | ok — template provider config dirs, no dropped adapter roots. |
| HOK-02 | INST-14 | wrong — clean newly copied hooks can be blocked against old/absent disk record (SR-PLT-08). |
| HOK-29 | INST-14, INST-15 | ok — separate owner hooks and their registrations preserved. |
| HIS-25 | MACH-05, MACH-06 | ok — Agent/Workflow main denies and SendMessage correction. |
| HIS-27 | MACH-18 | ok — selections and owner settings preserved; absent-only metadata handling follows synthesis. |
| HIS-30 | MACH-10, MACH-13, MACH-14 | wrong — no-secret intent is covered, but export short-value handling/shape is defective (SR-PLT-01/11). |
| HIS-31 | INST-25 | wrong — portability acceptance is insufficient for the complete runtime claim (SR-PLT-03). |
| HIS-32 | CONF-01, CONF-12, INST-17 | ok — single defaults/overlay/loader and seed-once preserved. |
| HIS-33 | INST-08, INST-24 | ok — ownership and owner-only skills retained, project links dropped under D-10. |
| HIS-34 | INST-19 | ok — generated-path gitignore block retained with removed link entries. |
| HIS-35 | INST-20, INST-21 | wrong — activation contract needs prospective-record clarification (SR-PLT-08). |
| HIS-36 | INST-30; ai-orchestrator delegated to M11 | wrong — delegation to M11 is valid under D-111, but kit-init root is wrong (SR-PLT-15). |
| HIS-76 | MACH-02, MACH-18, INST-29 | ok — explicit machine operations and offline tests, no MCP management. |
| HIS-88 | INST-12, INST-13 | wrong — outside-block preservation covered, classification of changed block is wrong (SR-PLT-09). |
| HIS-90 | MACH-08, MACH-03 | ok — replacement proposal explicitly superseded by additive-plus-notes D-15. |
| RUN-01 | CONF-01, CONF-02 | ok — layering, BOM, dangerous overlay keys and immutable defaults. |
| RUN-02 | CONF-04, CONF-13 | ok — per-entry merge retained and deprecated/non-Claude keys dropped; new appended-note interface missing (SR-PLT-13). |
| RUN-03 | CONF-03, MACH-06 | ok — project cannot override machine keys; agent_mcp dropped. |
| RUN-04 | MACH-06 | ok — D-06 overrides stale three-item main deny list. |
| RUN-05 | MACH-06, MACH-04 | ok — required worker denies/env, including added SendMessage. |
| RUN-06 | CONF-05, CONF-06 | wrong — schema rules retain obsolete read ceiling and omit consumer additions (SR-PLT-12/13). |
| RUN-07 | CONF-08 | ok — doctor continues after malformed JSON; normal commands fail closed. |
| RUN-08 | CONF-10 | ok — effective JSON and file-level provenance. |
| RUN-09 | CONF-10 | ok — kit-path lookup removed under D-04, manifest metadata retained. |
| RUN-10 | CONF-11 | wrong — concrete defaults violate D-16; warmup fields and new consumer keys unspecified (SR-PLT-07/13). |
| RUN-63 | CONF-09, CONF-12 | ok — shared loader and per-request settings; numeric read-limit conflict separately flagged (SR-PLT-12). |
| HOK-10 | CONF-06, CONF-13 | ok — three context fields validated and model_pattern rejected; default values supplied by CONF-11. |
| HOK-22 | CONF-06 | ok — four io fields, starts may be zero, steps positive; defaults/merge supplied by CONF-11/04. |
| HOK-37 | CONF-12, CONF-13 | ok — shared loader, single overlay path, legacy location ignored. |
| FIL-18 | CONF-09 | ok — per-request root/config, bad overlay fails call rather than registration. |
