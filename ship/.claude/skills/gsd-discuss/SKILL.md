---
name: gsd-discuss
description: "Runs the GSD discuss step for one phase in the main session - finds the phase's gray areas, asks the owner numbered questions and writes CONTEXT.md with stable D-NN decisions. Use when the owner wants to discuss, scope or decide a phase before planning, or when gsd-plan stops at stage Discuss. Not for planning itself (gsd-plan). Trigger on: 'discuss phase 3', 'scope this phase', 'what should this phase decide', 'bàn phase 3', 'chốt scope phase', 'thảo luận phase này'."
---

# gsd-discuss

Method text: follow `.agents/gsd/generated/workflows/discuss-phase.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-10, GSDF-11)

- Resolve the phase with `node .agents/harness/ph.mjs gsd roadmap get-phase <N>`; exit 66 means the phase is not on the ROADMAP: stop and say so.
- Blocking anti-patterns first: `node .agents/workflows/lib/gsd-flow.mjs anti-patterns <phaseDir>`. Exit 1 lists `blocking` rows of the phase's `.continue-here.md` without three written answers. For each row write, in `<phaseDir>/.continue-here.answers.json` (`{"<pattern>": {"what": ..., "manifested": ..., "prevention": ...}}`), what it is, how it manifested and which structural mechanism prevents it; ask the owner when the handoff does not tell. Proceed only when the check passes.
- Do not re-ask decisions already made in the last 3 CONTEXT files of earlier phases; cite them instead.
- Write `<phaseDir>/<NN>-DISCUSS-CHECKPOINT.json` (`{pending_question, answered[]}`) before the first question and after every answer; an interrupted discussion is resumed from it, and `gsd-plan` stops at stage Discuss while it exists.
- Questions: numbered plain text in the owner's language, one gray area at a time; wait; an empty reply is not approval. Scope creep goes to `<deferred>`.
- Write `<phaseDir>/<NN>-CONTEXT.md` (English) with `<domain>`, `<decisions>` (bullets `- **D-NN:** text`, stable ids, new ids appended, tags such as `[informational]` where the owner says so), `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`; plus `<NN>-DISCUSSION-LOG.md` (audit only, never agent input).
- Check the decisions parse: `node .agents/harness/ph.mjs gsd check decision-coverage-verify <N>` must list them.
- Remove the checkpoint file, then update STATE through `node .agents/harness/ph.mjs gsd state position --phase <N> --status "Ready to plan"`. No git step.
- Refused modes (one line each, no partial run): `--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`.
- Next: `gsd-research <N>` (when `gsd.research` is on) or `gsd-plan <N>`.
