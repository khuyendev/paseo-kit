# fix-machine: review of area MAC (.planning/intel/review/code-machine.md)

| Finding | Result | What changed |
|---|---|---|
| CR-MAC-01 | fixed | `kit/machine/export.mjs` `needlesOf()`: the 8-character minimum now applies only to secret values; every parsed host of a secret URL becomes a needle whatever its length, and the same list drives both the whole-token scrub and the pre-write leak check. Before the fix, `https://api.ai/v1` with `description: "Uses api.ai"` wrote `api.ai` into the template. New tests: `MACH-13 a short secret-URL host is scrubbed in a description and label (CR-MAC-01)` and `MACH-13 a short secret-URL host leaking through metadataGeneration exits 1 and keeps the old template`. Both fail on the old code. |
| CR-MAC-02 | fixed | `kit/machine/providers.mjs`: new `kitEntries(tpl, cfg)` returns the template entries named by `agent_providers`. Provider creation, model appends, `modelPlan` and `retiredModels` use only those entries now. Other template entries still supply link dirs (MACH-16 discovers every template provider's dir, so the link fixture stays valid). `kit/machine/check.mjs` passes `cfg` to both functions and lists the kit provider names in its "have every template model" line. New test: `MACH-18 template entries outside agent_providers are never created, given models or checked (CR-MAC-02)`. It fails on the old code, which added `template-model` to the owner's provider. |
| CR-MAC-03 | fixed | `kit/machine/links.mjs`: `repoint()` keeps the aside copy and returns it. `applyLinks()` records each disk change (created, repointed, removed). If the record write fails, it undoes those changes in reverse order: it removes created links, puts the aside copy back for re-pointed links, and re-creates removed links. Each step prints `link: undone <dest>`; a failed step prints `failed undo <dest>: ...` with the path to recover from. Aside copies are deleted only after the record is saved. New tests: `MACH-16 a failed link-record write undoes the created and re-pointed links; a retry then succeeds (CR-MAC-03)` and `MACH-16 a failed link-record write during unlink restores the removed links (CR-MAC-03)`. Both fail on the old code. |

No finding conflicts with D-109, D-110 or D-111. All changes are in kit/machine code.

## Tests

- `node --test tests/machine/*.test.mjs`: 51/51 pass (46 before, plus 5 new).
- `npm test`: 741 tests, 739 pass, 0 fail, 2 skipped (the skips are in other areas).
- I checked each new test against the code from before its fix (by stashing the fix): all five fail there.

## Requests filed

None.
