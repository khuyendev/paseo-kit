# Code review: machine (MAC)

## Verdict

REVISE; 1 BLOCKER, 2 MAJOR, 0 MINOR. The machine suite passes (46 tests, 46 passed, no skips), but export can write a secret endpoint host into the tracked template, provider patching exceeds the expressly allowed provider set, and link replacement can permanently lose its ownership record on a record-write failure. Reviewed every source/test file in the assigned paths, the MACH requirements, relevant synthesis/invariants and decisions, interfaces, all integration reports/requests, the install behavior map's machine rules, and the reference export at `ref-final`. No real machine configuration or daemon was used. Two additional in-memory probes confirmed the export leak and out-of-scope provider mutation; the link failure finding follows directly from the mutation/write ordering.

## Findings

### CR-MAC-01 BLOCKER security Short endpoint hosts bypass both export scrubbing and the leak assertion

- Severity: BLOCKER.
- Category: security.
- Where: `kit/machine/export.mjs:30-35`, `kit/machine/export.mjs:69-73` (MACH-13, MACH-14; INV-08).
- Evidence: `needlesOf()` applies `MIN_SCRUB_CHARS` to both the secret value and its URL host. MACH-13 exempts short secret **values** from free-text substitution, but separately requires scrubbing and detecting the host of a secret URL. With `env.ANTHROPIC_BASE_URL = "https://api.ai/v1"` and `description = "Uses api.ai"`, the complete URL becomes a placeholder, but the six-character host is omitted from the needles. The final leak check uses that same incomplete list. An in-memory call to the real `runExport()` returned `0` with `providers.circle.description` still equal to `"Uses api.ai"`; the captured template contained `api.ai`. A normal invocation would write that endpoint host to `paseo/providers.json`, despite the explicit no-endpoint-in-tracked-files rule. The existing long-host fixture does not expose this regression.
- Fix: Construct value and host needles separately: apply the eight-character minimum only to values, and include every nonempty parsed secret-URL host regardless of length. Use the complete host set in both scrubbing and the final assertion, retaining whole-token boundaries. Add an export regression with a short host in a label/description, plus a forced short-host leak in unsanitized metadata that must refuse the write and preserve the old template.

### CR-MAC-02 MAJOR invariant Apply patches providers outside agent_providers

- Severity: MAJOR.
- Category: invariant.
- Where: `kit/machine/providers.mjs:56-59`, `kit/machine/providers.mjs:74-81`; `tests/machine/links.test.mjs:11-17`; `tests/machine/apply.test.mjs:271-293` (MACH-18; INV-05).
- Evidence: The creation and model-append loops iterate every entry of `tpl.providers`, whereas MACH-18 permits changes only to provider names appearing as keys or values of `cfg.agent_providers`. Template loading does not reject additional names. An in-memory probe with the default `{circle: "circle-agent"}` mapping, live `owner.models = [{id: "owner-model"}]`, and an extra template `owner.models = [{id: "template-model"}]` produced `owner.models = [{id: "owner-model"}, {id: "template-model"}]` and the change line `added to owner: template-model`. Thus an owner-only provider is modified, not preserved. This is an accepted input shape today: the link tests deliberately introduce extra template providers without extending the mapping. The MACH-18 test includes an owner provider only in the live config, so it misses the boundary violation.
- Fix: Compute the allowed provider-name set from `agent_providers` once and restrict provider creation and model changes to that set. Reject unexpected template provider names before any write if they are not a supported input; alternatively leave them outside patch/check model management while retaining explicitly intended link-directory discovery. Update the link fixture to use mapped provider pairs if needed. Extend MACH-18 with an extra template entry matching a live owner-only provider and assert byte/JSON preservation of that provider, as well as no creation of unmapped providers.

### CR-MAC-03 MAJOR correctness Link changes become unrecoverably unowned when saving the record fails

- Severity: MAJOR.
- Category: correctness.
- Where: `kit/machine/links.mjs:75-84`, `kit/machine/links.mjs:101-118`, `kit/machine/links.mjs:57-60` (MACH-16; INV-03).
- Evidence: Creation/re-pointing changes the disk link immediately, but the ownership record is persisted only after the entire loop. Re-pointing also deletes the old link's aside copy before that persistence. If the atomic record write fails (for example, its final rename encounters a persistent Windows sharing/permission error), there is no rollback. A newly created link has no record, and a re-pointed link still has a record naming its old target. On the next run, `linkStates()` classifies either as `owner`, so neither `--link-user-skills` nor `--unlink-user-skills` can repair/remove the kit-created link. Retrying after the transient problem clears does not recover it. The current injected failure test covers only `symlinkSync()` failure, not failure to persist the ownership record.
- Fix: Make the disk mutation and ownership-record update recoverable as one operation. Keep each old link's aside copy until the new record is committed; on record-write failure, remove only newly created links from this invocation and restore re-pointed links from those aside copies. Include removals in the rollback bookkeeping as well. Report any rollback failure explicitly with the recovery paths rather than silently leaving stale provenance. Add injected record-write/rename-failure tests for initial link creation and re-pointing, asserting the previous disk/record state remains consistent and a subsequent retry succeeds.
