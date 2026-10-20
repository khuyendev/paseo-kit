// The one place the workflow module reaches runtime/ (code-ph exports): agent definitions, model selection, prompt
// assembly, worktrees, list-price cost and the caller-root check (runtime/index.mjs, never commands.mjs).
import {
  checkCallerRoot, checkRole, composePrompt, costUsd, createWorktree, discardWorktree, firstPromptNote, loadAgentDef, loadPrices,
  NOTE_READ_ONLY, roleParts, selectModel, workdirNote, worktreeNote,
} from "../runtime/index.mjs";
import { assertPromptSize } from "../paseo-client/index.mjs";

// FLOW-28 priming texts (shipped prompt text, D-35).
export const READY_LINE = "This message only loads your role. Reply with the single word READY; your task comes in the next message.";
export const primedTaskPrefix = (type) => `Task (your role, ${type}, and its files are in the first message; do not open them again):`;

const prices = new Map();

export const runtime = Object.freeze({
  loadAgentDefinition: (root, type) => loadAgentDef(root, type),
  checkRole: (cfg, role) => checkRole(cfg, role),
  selectModel: (cfg, { explicit, role, definition }) => selectModel({ cfg, explicit, role, definition }),
  // The first prompt of a workflow agent (PHCL-28); a primed agent's task names its role instead of repeating it.
  composePrompt: ({ def, prompt, readOnly, worktree, workdir, cfg, root, rolePrimed, tag }) => composePrompt({
    cfg, root, kind: "workflow", readOnly, worktree, workdir, runTag: tag,
    def: rolePrimed ? null : def,
    task: rolePrimed ? `${primedTaskPrefix(def.type)}\n\n---\n\n${prompt}` : prompt,
  }),
  // The role turn of a primed agent: role block, the safety notes, then the READY line (FLOW-28).
  rolePrompt: ({ def, readOnly, worktree, workdir, cfg }) => {
    const notes = [readOnly && NOTE_READ_ONLY, worktree ? worktreeNote(worktree) : workdir && workdirNote(workdir), firstPromptNote(cfg)].filter(Boolean);
    const parts = [...roleParts(def), ...(notes.length ? [`Runtime notes:\n${notes.map((n) => `- ${n}`).join("\n")}`] : []), READY_LINE];
    const text = parts.join("\n\n---\n\n");
    assertPromptSize(text, cfg);
    return text;
  },
  createWorktree: (root, cfg, name) => createWorktree(root, cfg, name),
  removeWorktree: (wt) => discardWorktree(wt),
  listPriceCost: (root, model, usage) => {
    if (!prices.has(root)) prices.set(root, loadPrices(root));
    return costUsd(prices.get(root), model, usage);
  },
  assertCallerInRoot: (session) => checkCallerRoot(session),
});
