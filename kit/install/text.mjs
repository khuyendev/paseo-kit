// Marked-text edits that keep every byte outside the kit's markers: AGENTS.md block (INST-12), .gitignore block (INST-19),
// CLAUDE.md import (INST-16).
export const START_PREFIX = "<!-- PASEO-HARNESS-KIT START";
export const START_LINE = "<!-- PASEO-HARNESS-KIT START: kit-owned; project text belongs outside these markers -->";
export const END_LINE = "<!-- PASEO-HARNESS-KIT END -->";
export const GITIGNORE_START = "# >>> paseo-harness-kit: generated paths (edit outside this block)";
export const GITIGNORE_END = "# <<< paseo-harness-kit";
export const GITIGNORE_PATHS = ["/_workspace/", "/.claude/worktrees/"];
export const IMPORT_LINE = "@AGENTS.md";

export const eolOf = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const withEol = (text, eol) => text.replace(/\r?\n/g, eol);

// Lines with their offsets: {text, start, end (after the line's EOL)}.
function lines(text) {
  const out = [];
  const re = /([^\r\n]*)(\r?\n|$)/g;
  for (let m; (m = re.exec(text)) && m.index < text.length; ) {
    out.push({ text: m[1], start: m.index, end: m.index + m[0].length });
    if (!m[0]) break;
  }
  return out;
}

// {status: "none"} | {status: "malformed"} | {status: "ok", body, bodyStart, bodyEnd, start, end}
export function findBlock(text, isStart = (l) => l.startsWith(START_PREFIX), isEnd = (l) => l.trimEnd() === END_LINE) {
  const all = lines(text);
  const starts = all.filter((l) => isStart(l.text));
  const ends = all.filter((l) => isEnd(l.text));
  if (!starts.length && !ends.length) return { status: "none" };
  if (starts.length !== 1 || ends.length !== 1 || ends[0].start < starts[0].start) return { status: "malformed" };
  const [s, e] = [starts[0], ends[0]];
  return { status: "ok", body: text.slice(s.end, e.start), bodyStart: s.end, bodyEnd: e.start, start: s.start, end: e.end };
}

// New file text with `body` as the block body; null when the markers are malformed.
export function putBlock(text, body) {
  if (text == null) return `${START_LINE}\n${body}\n${END_LINE}\n`;
  const eol = eolOf(text);
  const block = findBlock(text);
  if (block.status === "malformed") return null;
  if (block.status === "ok") return text.slice(0, block.bodyStart) + withEol(body, eol) + eol + text.slice(block.bodyEnd);
  const fresh = [START_LINE, withEol(body, eol), END_LINE].join(eol) + eol;
  return text ? fresh + eol + text : fresh;
}

// The file text without the block and its marker lines; null when there is no well-formed block.
export function dropBlock(text) {
  const block = findBlock(text);
  return block.status === "ok" ? text.slice(0, block.start) + text.slice(block.end) : null;
}

export function putGitignoreBlock(text) {
  const eol = text == null ? "\n" : eolOf(text);
  const blockLines = [GITIGNORE_START, ...GITIGNORE_PATHS, GITIGNORE_END];
  if (!text) return blockLines.join(eol) + eol;
  const block = findBlock(text, (l) => l.trimEnd() === GITIGNORE_START, (l) => l.trimEnd() === GITIGNORE_END);
  if (block.status === "malformed") throw new Error(`.gitignore has broken "${GITIGNORE_START}" markers; fix them by hand`);
  if (block.status === "ok") {
    const endText = /^[^\r\n]*/.exec(text.slice(block.bodyEnd))[0];
    return text.slice(0, block.start) + blockLines.join(eol) + text.slice(block.bodyEnd + endText.length);
  }
  const sep = text.endsWith("\n") ? eol : eol + eol;
  return text + sep + blockLines.join(eol) + eol;
}

// CLAUDE.md with `@AGENTS.md` after the leading run of `@` lines; null when the import is already there.
export function addImport(text) {
  if (text == null || text === "") return `${IMPORT_LINE}\n`;
  const all = lines(text);
  if (all.some((l) => l.text.trim() === IMPORT_LINE)) return null;
  const eol = eolOf(text);
  let i = 0;
  while (i < all.length && all[i].text.startsWith("@")) i++;
  const at = i ? all[i - 1].end : 0;
  const lead = i && !text.slice(0, at).endsWith("\n") ? eol : "";
  const followedByText = i < all.length && all[i].text.trim() !== "";
  return text.slice(0, at) + lead + IMPORT_LINE + eol + (followedByText ? eol : "") + text.slice(at);
}
