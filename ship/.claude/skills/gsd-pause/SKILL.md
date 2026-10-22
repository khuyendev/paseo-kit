---
name: gsd-pause
description: "Pauses GSD work with a handoff file and resumes from it later. Use when the owner says pause, stop for today, hand off, or resume, continue where we left off, pick up the work. Writes .planning/.continue-here.md and a STATE session note; resume reads them back. Trigger on: 'pause', 'stop for today', 'pick up where we left off', 'tạm dừng', 'nghỉ hôm nay', 'làm tiếp chỗ hôm qua'."
---

# gsd-pause

Method text: follow `.agents/gsd/generated/workflows/pause-work.md` to pause and `.agents/gsd/generated/workflows/resume-project.md` to resume (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-60)

Pause:
1. Collect from files only: position (`ph gsd state load`), open items (halt records, pending UAT tests, open debug sessions `ph gsd debug list`), uncommitted files (`git status --porcelain`), the next action.
2. Write `.planning/.continue-here.md` with those four sections plus the upstream "Critical Anti-Patterns" table when mistakes were found this session (severity `blocking` makes the next discuss or execute stop until each row has three written answers).
3. Add a STATE session note: `node .agents/harness/ph.mjs gsd state session-note --text-file <file>` (it replaces the Current state block).

Resume:
1. Read `.planning/.continue-here.md` and the STATE session note; report position, open items and the next action. Nothing comes from memory of an earlier conversation.
2. Ask the owner to confirm the next action; after the confirmation remove `.planning/.continue-here.md` and run that action.
