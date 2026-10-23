---
name: gsd-map-codebase
description: "Maps an existing codebase into the 7 GSD docs of .planning/codebase/ (stack, integrations, architecture, structure, conventions, testing, concerns) with 4 parallel mapper agents. Use when the owner asks to map, analyse or document the codebase, before the harness generates the project adapter, or when planning warns about map drift. Not for a new empty project (use gsd-new-project). Trigger on: 'map the codebase', 'analyse this repo', 'document the code', 'map codebase', 'phân tích codebase', 'đọc hiểu repo này'."
---

# gsd-map-codebase

<!-- PASEO-HARNESS-KIT START: kit-owned; project text belongs outside these markers -->
## Kit contract

Method text: follow `.agents/gsd/generated/workflows/map-codebase.md` (the generated upstream GSD text, unchanged), then apply the common kit overlay `.agents/workflows/gsd-overlay.md` and the project section below. The overlays win on conflict.

The workflow is the project's composition `.agents/workflows/gsd-map-codebase.js`: a script of kit verbs that the project owns and evolves. This block is the kit's contract for every composition; the project section below the markers describes what this project's script takes and returns.

Run: write the args file `_workspace/args/gsd-map-codebase.json` (its fields are in the project section), run `node .agents/harness/ph.mjs workflow --name gsd-map-codebase --args-file _workspace/args/gsd-map-codebase.json --detach` and wait as its `next:` line says. A run that died is continued with `node .agents/harness/ph.mjs workflow --resume <runId>` (finished agent calls replay from the journal); a stopped run is answered, then run again with the same args.

Result statuses (the success statuses, stages and fields of this script are in the project section):
- `needs-owner`: show `stage`, `reason` and the numbered `options`, with the items the result lists for that stage. The answer is the verb the result names (an option, or the answer line of the stop, such as a `ph gsd ... clear` verb): run it as written, then run again with the same args. A stop that names no verb is answered by fixing the tree or the inputs it names, then running again. Quota or rate limits never offer retry-now: report the reset time.
- `refused`: another run holds the lease or lock the reason names; nothing was dispatched. Wait for it to end, then run again.
- `failed`: report the reason and the problems the result lists.
- Never edit the flow's state or record files by hand (progress, transfer, halt, request, answer and revision records, run journals under `_workspace/_runs/`): only the run and the `ph gsd` / `gsd-flow.mjs` verbs write them. Never edit the workflow script to get past a stop: composition changes go through harness-evolve between runs.
<!-- PASEO-HARNESS-KIT END -->

## Project composition

This section is the project's (outside the kit markers; kit updates never change it). It describes `.agents/workflows/gsd-map-codebase.js` as this project runs it: args, switches, stages and result fields. harness-evolve changes it together with the script; seeded from the kit default.

1. Existing map: when `.planning/codebase/` already holds documents, ask the owner: 1) refresh all, 2) update chosen docs (name them), 3) skip. Skip ends here.
2. Run the mapper workflow (4 parallel `gsd-codebase-mapper` agents: tech, arch, quality, concerns; they write the docs and return only confirmations):
   - args file `_workspace/args/gsd-map-codebase.json`: `{}` for a full map, `{"docs": "STACK,TESTING"}` for an update, `{"paths": "src/a,lib/b"}` for an incremental remap.
   - `node .agents/harness/ph.mjs workflow --name gsd-map-codebase --args-file _workspace/args/gsd-map-codebase.json --detach`, then wait as the `next:` line says.
3. Result:
   - `mapped`: the 7 docs exist with at least 20 lines each and every Known Bug in CONCERNS.md is `verified` (with its `Evidence:`) or `suspected`; the review stage (one read-only `gsd-map-reviewer` per focus, judging its docs against the code) found no open claim after at most one fix round by the focus's mapper (`review.fixed` names the focus areas that got one), and a resolution check confirmed those findings resolved; claims the check raised anew are in `review.findings` (show them to the owner; they do not stop the map); an incremental map reviews only its `paths`. The stamp step wrote `last_mapped_commit`/`last_mapped_at` into each doc (a shell step, never the mapper), docs were committed when `gsd.commit_policy.docs` is on.
   - `needs-owner` stage Map with `findings`: a possible secret (key prefix, private key, JWT) is in a doc; nothing was committed. Show file, line and kind (never the value) and wait for the owner.
   - `needs-owner` stage Review with `findings` (file, claim, problem, evidence): claims the code does not support are still in the docs after one fix round; nothing was stamped or committed. Show them and let the owner correct the docs by hand and rerun the map, or rerun it.
   - `refused`: another map run holds this code root's `codebase-map` lease; run the map after it ends. Nothing was written.
   - With `gsd.map_mode: per-focus` (kit default `whole`, the statuses above) each focus runs as its own stream: map, check (a doc check problem goes back to that focus's mapper once, `mapper-check-<focus>`), review, fix, resolution check, and it is stamped as soon as it is clean; one docs commit of the stamped focuses ends the run. The result carries `mode: "per-focus"` and `focuses` (per focus: `status` stamped, failed or needs-owner, `stage`, `reason`, `findings`, `rechecked`, `fixed`). All stamped is `mapped`. `partial`: some focus is open; its docs were neither stamped nor committed, the others were. Show `reason` and `findings`, then let the owner choose: correct the open focus by hand and resume (`ph workflow --resume <run>`; the journal replays every finished agent, so only what the correction changed runs again), or rerun only the open focus with the result's `rerun` args (e.g. `{"docs": "CONCERNS"}`). When no focus is stamped the status is `needs-owner` (with `stage`, `findings`, `options`) or `failed`, with `rerun` too.
   - `failed`: report the reason (`--paths` with `..`, a dots-only segment, a leading `/` or shell metacharacters is rejected before any agent; spaces inside a path are allowed; a mapper with no reply, or a reply that does not name exactly its docs, after one retry; a Known Bug without a status, or a doc failing the doc check, in `map incomplete`; a reviewer with no usable reply after one retry, or a mapper whose review fix does not name every doc with a finding (and nothing outside its focus); `HEAD moved during the map` when a commit landed while the mappers ran). A failed run stamps nothing and commits nothing; docs that a mapper already rewrote stay on disk uncommitted; rerun the map after a HEAD move.
4. Next step: the `harness` skill reads the map and generates the project adapter; then `gsd-new-project` (or `gsd-plan` for an initialized project).

The drift gate: at plan start `gsd-plan` compares the map's `last_mapped_commit` with the tree and warns (never blocks) when new directories plus changed files in mapped directories reach `gsd.drift_threshold`; an unstamped map reports `skipped`. Answer a drift warning with `{"paths": ...}` above.
