---
name: gsd-map-codebase
description: "Maps an existing codebase into the 7 GSD docs of .planning/codebase/ (stack, integrations, architecture, structure, conventions, testing, concerns) with 4 parallel mapper agents. Use when the owner asks to map, analyse or document the codebase, before the harness generates the project adapter, or when planning warns about map drift. Not for a new empty project (use gsd-new-project). Trigger on: 'map the codebase', 'analyse this repo', 'document the code', 'map codebase', 'phân tích codebase', 'đọc hiểu repo này'."
---

# gsd-map-codebase

Method text: follow `.agents/gsd/generated/workflows/map-codebase.md` (the generated upstream GSD text, unchanged), then apply the common kit overlay `.agents/workflows/gsd-overlay.md` and the overlay below. The overlays win on conflict.

## Kit overlay

1. Existing map: when `.planning/codebase/` already holds documents, ask the owner: 1) refresh all, 2) update chosen docs (name them), 3) skip. Skip ends here.
2. Run the mapper workflow (4 parallel `gsd-codebase-mapper` agents: tech, arch, quality, concerns; they write the docs and return only confirmations):
   - args file `_workspace/args/gsd-map-codebase.json`: `{}` for a full map, `{"docs": "STACK,TESTING"}` for an update, `{"paths": "src/a,lib/b"}` for an incremental remap.
   - `node .agents/harness/ph.mjs workflow --name gsd-map-codebase --args-file _workspace/args/gsd-map-codebase.json --detach`, then wait as the `next:` line says.
3. Result:
   - `mapped`: the 7 docs exist with at least 20 lines each, the stamp step wrote `last_mapped_commit`/`last_mapped_at` into each doc (a shell step, never the mapper), docs were committed when `gsd.commit_policy.docs` is on.
   - `needs-owner` stage Map with `findings`: a possible secret (key prefix, private key, JWT) is in a doc; nothing was committed. Show file, line and kind (never the value) and wait for the owner.
   - `failed`: report the reason (`--paths` with `..`, a dots-only segment, a leading `/` or shell metacharacters is rejected before any agent; spaces inside a path are allowed).
4. Next step: the `harness` skill reads the map and generates the project adapter; then `gsd-new-project` (or `gsd-plan` for an initialized project).

The drift gate: at plan start `gsd-plan` compares the map's `last_mapped_commit` with the tree and warns (never blocks) when new directories plus changed files in mapped directories reach `gsd.drift_threshold`; an unstamped map reports `skipped`. Answer a drift warning with `{"paths": ...}` above.
