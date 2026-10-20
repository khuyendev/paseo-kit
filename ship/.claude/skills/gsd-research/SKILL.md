---
name: gsd-research
description: Views, reuses or refreshes the research report of one GSD phase through one gsd-phase-researcher agent. Use when the owner asks to research a phase, look at or refresh its RESEARCH.md, or when gsd-plan stops at stage Research. Standalone: never continues into planning.
---

# gsd-research

Kit-authored wrapper (no upstream standalone research flow). The researcher's dispatch text is the vendored upstream fragment rendered by `ph gsd research prompt`; apply `.agents/workflows/gsd-overlay.md`.

## Modes (GSDF-12, GSDF-13)

Args file `_workspace/args/gsd-research.json` with `phaseDir` (`.planning/phases/<NN>-<slug>`), then `node .agents/harness/ph.mjs workflow --name gsd-research --args-file _workspace/args/gsd-research.json --detach` and wait as `next:` says.

- `--view` -> `{"phaseDir": ..., "view": true}`: no agent; prints the report status. With no report the run returns `failed` ("no research report"): report that as an error.
- `--refresh [focus]` -> `{"phaseDir": ..., "refresh": true, "focus": "..."}`: a fresh researcher keeps still-valid findings and writes a new report.
- default -> `{"phaseDir": ...}`: a valid current report is `reused` (say when `headChanged`); a missing report is researched now; an invalid, blocked or stale report: report its status and offer `--refresh` instead of researching silently.

## Results
- `researched` / `reused`: summarise the findings and the open questions for the owner. An `[ASSUMED]` item stays an assumption; never turn it into a locked decision (decisions come only from gsd-discuss).
- `needs-owner` stage Discuss: finish `gsd-discuss` first. Stage Research: the researcher reported blockers; show them. Stage Research with `reportStatus` (invalid, blocked, incomplete or stale): no agent ran; show the status and offer `--refresh`.
- `failed`: a report whose attempt key or digest is not this run's, or no report; show the reason.

The researcher writes only the RESEARCH.md path with `input_digest`, `attempt_key` and the terminal marker; it does not build, test, install or commit, keeps provenance tags, and never reports the package audit as OK (it is not installed). Standalone research ends here: suggest `gsd-plan <N>` as the next command.
