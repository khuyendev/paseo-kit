// read_ranges (FTOL-21..25): independent entries, size caps with "lines a-b fit" hints, binary refusal, and a
// bounded-memory reader: a line longer than the budget never becomes one JS string (INV-32).
import fs from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { guessPath } from "./guess.mjs";
import { absolutePath } from "./targets.mjs";

export const fmt = (n) => n.toLocaleString("en-US");
export const BINARY_PROBE_BYTES = 8000;
const FOLDER_ENTRIES = 30;
const SCRIPT_HINT = "a line range cannot cut it: extract the part you need with a script (jq, node, grep -o)";

// a file is binary when its first 8,000 bytes hold a NUL byte (the test git uses)
export function isBinary(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(BINARY_PROBE_BYTES);
    return buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).includes(0);
  } finally {
    fs.closeSync(fd);
  }
}

export const binaryText = (bytes) =>
  `not read: a binary file (${fmt(bytes)} bytes), not text; open images and PDFs with the native Read tool; read other binary files with a script or a tool made for them`;

// lines as read_ranges counts them: newlines + 1, counted in byte chunks
export function lineCount(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 20);
  let lines = 1;
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) {
      for (let i = buf.indexOf(10, 0); i !== -1 && i < n; i = buf.indexOf(10, i + 1)) lines++;
    }
  } finally {
    fs.closeSync(fd);
  }
  return lines;
}

// Lines from..to (clamped) with CR stripped, kept only while the rendered body stays within maxChars.
// Returns { total, from, to, width, pastEnd?, chars, fit, firstLength, lines|null }.
export function readSpan(file, from, requestedTo, maxChars) {
  const total = lineCount(file);
  if (from > total) return { total, from, to: from, pastEnd: true };
  const to = Math.min(total, requestedTo ?? total);
  const width = String(to).length;
  let number = 1, len = 0, last = "", parts = [], chars = 0, fit = from - 1, firstLength = 0;
  let lines = [];
  const prefix = width + 2; // "<n>| "
  const sep = () => (number > from ? 1 : 0);
  const piece = (text) => {
    if (!text) return;
    len += text.length;
    last = text[text.length - 1];
    if (number < from || number > to) return;
    if (lines && parts && chars + sep() + prefix + len <= maxChars + 1) parts.push(text);
    else parts = null;
  };
  const endLine = () => {
    if (number >= from && number <= to) {
      const size = len - (last === "\r" ? 1 : 0);
      if (number === from) firstLength = size;
      chars += sep() + prefix + size;
      if (chars <= maxChars) {
        fit = number;
        if (lines) lines.push(parts ? parts.join("").slice(0, size) : "");
      } else lines = null;
    }
    number++;
    len = 0;
    last = "";
    parts = [];
  };
  const decoder = new StringDecoder("utf8");
  const buf = Buffer.alloc(65536);
  const fd = fs.openSync(file, "r");
  const consume = (chunk) => {
    let start = 0;
    for (let at = chunk.indexOf("\n"); at !== -1 && number <= to; at = chunk.indexOf("\n", start)) {
      piece(chunk.slice(start, at));
      endLine();
      start = at + 1;
    }
    if (number <= to) piece(chunk.slice(start));
  };
  try {
    for (let n; number <= to && (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; ) consume(decoder.write(buf.subarray(0, n)));
    if (number <= to) {
      consume(decoder.end());
      if (number <= to) endLine();
    }
  } finally {
    fs.closeSync(fd);
  }
  return { total, from, to, width, chars, fit, firstLength, lines };
}

export const renderLines = (from, width, lines) => lines.map((line, i) => `${String(from + i).padStart(width)}| ${line}`).join("\n");

// ctx: { cwd, limits, guard(abs), store } where store.registerRead / store.dropRead keep the line-edit tags
export function readRanges({ ranges }, ctx) {
  const { cwd, limits, guard, store } = ctx;
  const errors = [];
  const out = [];
  let room = limits.replyMaxChars;
  const deferred = `not read in this call: with it the reply would pass ${fmt(limits.replyMaxChars)} characters; read it in another call`;
  for (const r of ranges) {
    let abs, note = "", stat, span;
    try {
      abs = absolutePath(r.path, cwd);
      if (!fs.existsSync(abs)) {
        const g = guessPath(abs, cwd);
        if (!g.unique) {
          errors.push(`${r.path}: file not found${g.candidates.length ? `; did you mean: ${g.candidates.join(" | ")}` : ""}`);
          continue;
        }
        abs = g.unique;
        note = ` (read in place of ${r.path}, which does not exist: the only file of that name nearby)`;
      }
      guard(abs);
      stat = fs.statSync(abs);
    } catch (e) {
      errors.push(`${r.path}: ${e.message}`);
      continue;
    }
    if (stat.isDirectory()) {
      const names = fs.readdirSync(abs);
      errors.push(`${r.path}: is a folder; it holds ${names.length} entries: ${names.slice(0, FOLDER_ENTRIES).join(", ")}${names.length > FOLDER_ENTRIES ? ", ..." : ""}`);
      continue;
    }
    if (r.to !== undefined && r.from !== undefined && r.to < r.from) {
      errors.push(`${r.path}: to ${r.to} is before from ${r.from}`);
      continue;
    }
    try {
      if (stat.size > 0 && isBinary(abs)) {
        errors.push(`${r.path}: ${binaryText(stat.size)}`);
        continue;
      }
      span = readSpan(abs, r.from ?? 1, r.to, limits.fileMaxChars);
    } catch (e) {
      errors.push(`${r.path}: ${e.message}`);
      continue;
    }
    const { from, to, total } = span;
    if (span.pastEnd) {
      errors.push(`${r.path}: line ${from} is past the end (${total} lines)`);
      continue;
    }
    if (!span.lines) {
      const cut = span.fit < from
        ? `line ${from} alone has ${fmt(span.firstLength)} characters, so ${SCRIPT_HINT}`
        : `lines ${from}-${span.fit} fit; read the part you need (grep -n finds it) or the lines in parts`;
      errors.push(`${r.path}: lines ${from}-${to} have ${fmt(span.chars)} characters, over the ${fmt(limits.fileMaxChars)}-character limit for one entry; ${cut}`);
      continue;
    }
    const tag = span.lines.length === to - from + 1 ? store.registerRead(abs, from, span.lines, total) : null;
    const entry = `===== ${abs} lines ${from}-${to} of ${total}${tag ? `, tag ${tag}` : ""}${note}\n${renderLines(from, span.width, span.lines)}`;
    if (entry.length > room) {
      if (tag) store.dropRead(tag);
      errors.push(`${r.path} lines ${from}-${to}: ${deferred}`);
      continue;
    }
    room -= entry.length + 2; // entries are joined by a blank line
    out.push(entry);
  }
  if (!out.length) return { isError: true, text: errors.join("\n") };
  return [out.join("\n\n"), errors.map((e) => `ERROR ${e}`).join("\n")].filter(Boolean).join("\n\n");
}
