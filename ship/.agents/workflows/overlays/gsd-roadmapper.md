# Kit overlay: gsd-roadmapper

Applied after the upstream roadmapper body; wins on conflict (D-111).

- Write your outputs to `.planning/drafts/ROADMAP.md` and `.planning/drafts/traceability.json` (`{"<requirement id>": "<phase number>"}`) instead of the paths the body names.
- Never write `.planning/ROADMAP.md`, `.planning/STATE.md` or `.planning/REQUIREMENTS.md`: the orchestrator validates the draft, presents it for approval and installs it through the single writer.
- Map every v1 requirement to exactly one phase; give every phase 2-5 numbered success criteria.
- Never ask the owner: the orchestrator runs the approval loop.
