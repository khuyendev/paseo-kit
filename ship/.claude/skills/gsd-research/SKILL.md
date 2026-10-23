---
name: gsd-research
description: "Views, reuses or refreshes the research report of one GSD phase through one gsd-phase-researcher agent. Use when the owner asks to research a phase, look at or refresh its RESEARCH.md, or when gsd-plan stops at stage Research. Standalone: never continues into planning. Trigger on: 'research phase 3', 'refresh the research', 'show RESEARCH.md', 'research phase 3 đi', 'tìm hiểu trước phase', 'nghiên cứu phase này'."
---

# gsd-research

Kit-authored wrapper (no upstream standalone research flow). The researcher's dispatch text is the vendored upstream fragment rendered by `ph gsd research prompt`; apply `.agents/workflows/gsd-overlay.md`.

## Modes (GSDF-12, GSDF-13)

Args file `_workspace/args/gsd-research.json` with `phaseDir` (`.planning/phases/<NN>-<slug>`), then `node .agents/harness/ph.mjs workflow --name gsd-research --args-file _workspace/args/gsd-research.json --detach` and wait as `next:` says.

- `--view` -> `{"phaseDir": ..., "view": true}`: no agent; prints the report status. With no report the run returns `failed` ("no research report"): report that as an error.
- `--refresh [focus]` -> `{"phaseDir": ..., "refresh": true, "focus": "..."}`: a fresh researcher keeps still-valid findings and writes a new report.
- default -> `{"phaseDir": ...}`: a valid current report is `reused` (say when `headChanged`); a missing report is researched now; an invalid, blocked, stale or changed report (edited after its accepted run): report its status and offer `--refresh` instead of researching silently.
- `--refresh code` -> `{"phaseDir": ..., "refresh": "code"}` (only with `gsd.research_ahead`): a researcher re-verifies only the report's `## Code APIs` against the current code and leaves every other section as it is.

## Research ahead (`gsd.research_ahead`, off by default)

With the switch on, the phase can be researched while earlier phases still execute (the research lock is per phase; it never waits for execute). A run whose earlier phases are not COMPLETE is an ahead run: libraries, upstream UI and the phase decisions are researched as usual, every claim about the project's own code goes into `## Code APIs` with `[PENDING: phase <n>]` where it rests on code those phases are still writing, and the frontmatter lists them in `ahead_of`. The report then reads:
- `provisional` while a phase in `ahead_of` is not COMPLETE: the default run returns `provisional` with `pendingPhases` (no agent); gsd-plan does not plan on it. A source edit by the running phase does not make it stale; a change of CONTEXT, requirements, roadmap, instructions or the researcher's role text does.
- `code-stale` once they are COMPLETE (`reason: ahead`), or when the only research inputs that changed are files under `adapter.ownership.source_roots` (`reason: source`, `changed` lists them): offer `--refresh code` (cheap) before `--refresh`.
A code refresh is refused (needs-owner) on a provisional report (its phases are not complete), on a stale, invalid, blocked, changed or incomplete one (run a full `--refresh`), and on a report without `## Code APIs`. Its result lists `outsideCode` (sections it changed outside `## Code APIs`, accepted but shown to the owner) and `needsFullRefresh` (findings outside the section the current code contradicts): when either is non-empty, offer a full `--refresh`.

## Results
- `researched` / `reused`: summarise the findings and the open questions for the owner. With the switch on, `researched` also says what ran: `part` (`full` or `code`), `aheadOf` and `reportStatus` (`provisional` after an ahead run).
- `provisional`: the report waits for `pendingPhases`; after they complete, run `--refresh code`. An `[ASSUMED]` item stays an assumption; never turn it into a locked decision (decisions come only from gsd-discuss).
- `needs-owner` stage Discuss: finish `gsd-discuss` first. Stage Research: the researcher reported blockers; show them. Stage Research with `reportStatus` (invalid, blocked, incomplete, stale, changed, code-stale or provisional): no agent ran; show the status and the `options` (`refresh code` first for code-stale).
- `failed`: a report whose attempt key or digest is not this run's, or no report; show the reason, and the `problems` the result lists (the researcher's own status check, or the report's blockers).
- `refused`: another research of this phase holds its lock (the reason names the run); nothing was dispatched or recorded. Wait for that run to end, then research again.

The researcher writes only the RESEARCH.md path with `input_digest`, `attempt_key` and the terminal marker; before its final reply it runs `ph gsd research status` on that report and fixes every listed problem; it does not build, test, install or commit, keeps provenance tags, and never reports the package audit as OK (it is not installed). Standalone research ends here: suggest `gsd-plan <N>` as the next command.
