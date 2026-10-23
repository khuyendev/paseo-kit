---
name: gsd-discuss
description: "Runs the GSD discuss step for one phase in the main session - finds the phase's gray areas, asks the owner numbered questions and writes CONTEXT.md with stable D-NN decisions. Use when the owner wants to discuss, scope or decide a phase before planning, or when gsd-plan stops at stage Discuss. Not for planning itself (gsd-plan). Trigger on: 'discuss phase 3', 'scope this phase', 'what should this phase decide', 'bàn phase 3', 'chốt scope phase', 'thảo luận phase này'."
---

# gsd-discuss

Method text: follow `.agents/gsd/generated/workflows/discuss-phase.md` (generated upstream text, unchanged), then apply `.agents/workflows/gsd-overlay.md` and the overlay below (overlays win).

## Kit overlay (GSDF-10, GSDF-11)

- Resolve the phase with `node .agents/harness/ph.mjs gsd roadmap get-phase <N>`; exit 66 means the phase is not on the ROADMAP: stop and say so.
- Blocking anti-patterns first: `node .agents/workflows/lib/gsd-flow.mjs anti-patterns <phaseDir>`. Exit 1 lists `blocking` rows of the phase's `.continue-here.md` without three written answers. For each row write, in `<phaseDir>/.continue-here.answers.json` (`{"<pattern>": {"what": ..., "manifested": ..., "prevention": ...}}`), what it is, how it manifested and which structural mechanism prevents it (a decision already in CONTEXT is a valid answer: cite its D-NN); ask the owner when neither the handoff nor CONTEXT tells. Write the file with the kit script, never by hand: `node .agents/workflows/lib/gsd-flow.mjs write <phaseDir>/.continue-here.answers.json` with the whole JSON on stdin. Proceed only when the check passes.
- Do not re-ask decisions already made in the last 3 CONTEXT files of earlier phases; cite them instead.
- Write `<phaseDir>/<NN>-DISCUSS-CHECKPOINT.json` (`{pending_question, answered[]}`) before the first question and after every answer; an interrupted discussion is resumed from it, and `gsd-plan` stops at stage Discuss while it exists.
- Questions: numbered plain text in the owner's language, one gray area at a time; wait; an empty reply is not approval (a delegated discuss answers instead, see below). Scope creep goes to `<deferred>`.
- Write `<phaseDir>/<NN>-CONTEXT.md` (English) with `<domain>`, `<decisions>` (bullets `- **D-NN:** text`, stable ids, new ids appended, tags such as `[informational]` where the owner says so, `[delegated]` in a delegated discuss), `<canonical_refs>`, `<code_context>`, `<specifics>`, `<deferred>`; plus `<NN>-DISCUSSION-LOG.md` (audit only, never agent input).
- Check the decisions parse: `node .agents/harness/ph.mjs gsd check decision-coverage-verify <N>` must list them.
- Remove the checkpoint file, then update STATE through `node .agents/harness/ph.mjs gsd state position --phase <N> --status "Ready to plan"`. No git step.
- Refused modes (one line each, no partial run): `--power`, `--auto`, `--chain`, advisor, `--ws`, `--batch`, `--analyze`.
- Next: `gsd-research <N>` (when `gsd.research` is on) or `gsd-plan <N>`.

## Discussing ahead of a running phase

Phase N+1 may be discussed while phase N executes (discuss takes no lease and writes only phase N+1's files). Then:
- Skip the STATE step while `node .agents/harness/ph.mjs gsd roadmap analyze` shows an earlier phase not COMPLETE; the position moves when that phase completes or N+1 is planned.
- Decide behaviour, scope and libraries; do not lock the API of code phase N is still writing (cite it in `<canonical_refs>` or `<code_context>` as pending instead). A decision that only the finished code can settle goes back to the owner after phase N completes, or into `<deferred>`.
- Next: `gsd-research <N+1>`; with `gsd.research_ahead` it runs ahead and its `## Code APIs` part is refreshed (`refresh: "code"`) after phase N completes.

## Delegated discuss

Entered only when the owner's message for this phase delegates the answers in plain words (for example "decide the gray areas yourself"); never by a default, an empty reply or an earlier run. `--auto` and `--chain` stay refused (above), so they never enter this mode.

- Write the owner's authority to `<phaseDir>/<NN>-DISCUSS-CHECKPOINT.json` before the first answer: `"delegated": {"by": "owner", "authority": "<the owner's words, quoted>"}` beside `pending_question` and `answered[]`.
- Then the main session answers each gray area itself, within the quoted authority; it never asks the owner and never lets a worker answer; a gray area outside the quoted authority goes back to the owner as a numbered question.
- Each answer is a decision `- **D-NN:** [delegated] text` in CONTEXT, with a stable id like any other. `<NN>-DISCUSSION-LOG.md` records for it the question, the options weighed and the rationale for the answer.
- Finish by: list every `[delegated]` decision with its one-line reason in the reply, in the owner's language, so the owner can revise them with a normal discuss run.
- The rest of this overlay still applies (anti-patterns, scope creep, decision check, STATE step). The delegation covers the answers only, not the plan or the later gates: gsd-plan still stops at its own `needs-owner`.
