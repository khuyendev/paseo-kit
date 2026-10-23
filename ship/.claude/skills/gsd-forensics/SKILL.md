---
name: gsd-forensics
description: "Investigates a failed or stuck GSD run read-only (git history, debug sessions, workflow run records, gate evidence) and writes one dated forensics report. Use when the owner asks what went wrong, why a run or phase failed, for a post-mortem or forensics. Not for fixing the bug (gsd-debug). Trigger on: 'what went wrong', 'post-mortem of the run', 'why did the phase fail', 'sao run bị hỏng', 'chuyện gì đã xảy ra với run', 'mổ xẻ run lỗi'."
---

# gsd-forensics

Method text: follow `.agents/gsd/generated/workflows/forensics.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-63)

- Main session, read-only: no agent, no workflow, no build, no test. Skip the upstream multi-runtime `gsd_run` bootstrap and the GitHub-issue step.
- Evidence: git history (`git log`, `git show --stat`), `.planning/debug/` sessions, `_workspace/_runs/<runId>/` records (`run.json`, `journal.jsonl` null reasons, `log.txt`), gate evidence `<phaseDir>/evidence/*.json`, halt records, `review/` records.
- Add the kit anomaly: the same failure signature repeating across runs or sessions without a persistent hypothesis record (no debug session or Evidence entry naming it) is a loop.
- Report path: send the topic on stdin as one line, never as command text, because git history, run records and logs can carry shell text from a commit message or failure output. In sh: `node .agents/workflows/lib/gsd-flow.mjs forensics-path <<'EOF'`, the topic line, then `EOF` on its own line. In PowerShell: pipe a single-quoted here-string (`@'`, the topic line, `'@`) into `node .agents/workflows/lib/gsd-flow.mjs forensics-path`. The command prints one JSON object whose `path` field is `.planning/forensics/<YYYY-MM-DD>-<slug>.md`. Write only that file: relative paths only (no home or absolute paths), credentials stripped, every diff cut at 50 lines, and every hypothesis labelled "forensic hypothesis, not debugger-confirmed".
- The one exception to report-only output: when the investigation concerns the active phase, add one STATE session note through `node .agents/harness/ph.mjs gsd state session-note --text-file <file>` pointing at the report. Otherwise `git status` shows only the report.
