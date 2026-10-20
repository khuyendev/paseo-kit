// First-prompt assembly (PHCL-28..31). The note texts are owner-reviewed prompt text carried verbatim (D-35, INV-49).
import path from "node:path";
import { assertPromptSize } from "../paseo-client/index.mjs";
import { phCommand } from "../lib/cli.mjs";
import { id8, samePath, toSlash } from "../lib/paths.mjs";

export const NOTE_RETURN_VALUE = "Your final message is the return value for the orchestrating script, not a message to a person: return only the data asked for.";
export const NOTE_SILENT = "Work silently: no narration, plans or commentary between tool calls (nobody reads them); only your final reply, in the format asked for.";
export const NOTE_READ_ONLY = "Read-only role: do not create, edit, move or delete files, except output files this prompt names.";
export const INCLUDES_HEADER = "These files are already loaded in full below; do not open them and do not call the Skill tool for them.";

export const KINDS = Object.freeze(["team", "oneshot", "workflow"]);

export const workdirNote = (dir) => `Your working directory for this task is ${dir}: run shell commands there and resolve relative paths against it.`;

export const worktreeNote = (wt) => `You work in the git worktree ${wt.path} (branch ${wt.branch}): edit files only there, run git and shell commands with that directory as their working directory, and use absolute paths.`;

const wsArg = (ws) => {
  if (!ws) return "<workspace>";
  const text = toSlash(ws);
  return /\s/.test(text) ? `"${text}"` : text;
};

export function teammateNote({ name, leader, ws }) {
  const ph = phCommand();
  const w = wsArg(ws);
  return `You are the teammate "${name}" of a Paseo agent team led by agent ${id8(leader)}. The leader sends you follow-up messages and you keep your context between them; end every turn with your reply to the leader. Shared task list: \`${ph} task list --ws ${w}\` and \`${ph} task update --ws ${w} <id> --status <status>\`; message a teammate: \`${ph} send --prompt "..." <teammate>\`.`;
}

// Kit note, then the project's note, then the platform note; the kit note cannot be replaced by an overlay (CONF-14).
export function firstPromptNote(cfg, platform = process.platform) {
  return [cfg.first_prompt_note, cfg.project_prompt_note, cfg.platform_notes[platform]].filter((t) => t && t.trim()).join(" ");
}

export function roleParts(def) {
  if (!def) return [];
  const parts = [`Your role (${def.type}), complete below:\n\n${def.body}`];
  if (def.includes.length) parts.push(`${INCLUDES_HEADER}\n\n${def.includes.map((i) => `===== ${i.rel} =====\n${i.text}`).join("\n\n")}`);
  return parts;
}

/**
 * The first prompt of an agent. kind: team (spawn, fanout), oneshot (fanout --collect), workflow (agent()).
 * worktree {path, branch} replaces the working-directory note; workdir is noted only when it differs from root.
 * The definition's path and its `tools:` list never appear.
 */
export function composePrompt({ cfg, root, task, def = null, kind, name, leader, ws, readOnly = false, worktree = null, workdir = null, runTag = null, platform = process.platform }) {
  if (!KINDS.includes(kind)) throw new Error(`unknown prompt kind ${kind}`);
  const notes = [kind === "workflow" ? NOTE_RETURN_VALUE : NOTE_SILENT];
  if (kind === "team") notes.push(teammateNote({ name, leader, ws }));
  if (readOnly) notes.push(NOTE_READ_ONLY);
  if (worktree) notes.push(worktreeNote(worktree));
  else if (workdir && !samePath(workdir, root)) notes.push(workdirNote(path.resolve(workdir)));
  const first = firstPromptNote(cfg, platform);
  if (first) notes.push(first);
  if (runTag) notes.push(`Run ${runTag.runId} #${runTag.n} (bookkeeping only; ignore).`);
  const text = `${[...roleParts(def), String(task).trim()].join("\n\n---\n\n")}\n\n---\nRuntime notes:\n${notes.map((n) => `- ${n}`).join("\n")}`;
  assertPromptSize(text, cfg);
  return text;
}
