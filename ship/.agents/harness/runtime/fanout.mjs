// The fanout file format (PHCL-08): an optional preamble, then blocks opened by `=== <name> [key=value ...]`.
import { UsageError } from "../lib/cli.mjs";
import { safeName } from "../lib/paths.mjs";

export const BLOCK_OPTIONS = Object.freeze(["type", "role", "model", "effort", "read-only"]);

function header(line) {
  const words = line.slice(4).trim().split(/\s+/).filter(Boolean);
  const opts = {};
  while (words.length > 1 && /^[a-z-]+=/.test(words.at(-1))) {
    const word = words.pop();
    const at = word.indexOf("=");
    opts[word.slice(0, at)] = word.slice(at + 1);
  }
  const name = words.join(" ");
  for (const key of Object.keys(opts)) {
    if (!BLOCK_OPTIONS.includes(key)) throw new UsageError(`block '${name}': unknown option ${key}=`);
  }
  if (Object.hasOwn(opts, "read-only")) opts["read-only"] = opts["read-only"] === "true";
  return { name, opts };
}

export function parseFanout(text, file = "fanout file") {
  const blocks = [];
  const preamble = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^=== /.test(line)) {
      current = { ...header(line), lines: [] };
      blocks.push(current);
    } else if (current) current.lines.push(line);
    else preamble.push(line);
  }
  if (!blocks.length) throw new UsageError(`${file} has no '=== <name>' blocks`);
  const pre = preamble.join("\n").trim();
  return blocks.map(({ name, opts, lines }) => {
    const body = lines.join("\n").trim();
    return { name, opts, prompt: pre ? `${pre}\n\n${body}` : body };
  });
}

// Unique names, and output files (`<safe name>.md`) that stay distinct on a case-insensitive file system.
export function checkBlockNames(blocks) {
  const seen = new Set();
  const files = new Map();
  for (const { name } of blocks) {
    if (!name) throw new UsageError("a block has no name");
    if (seen.has(name)) throw new UsageError(`duplicate block name ${name}`);
    seen.add(name);
    const key = safeName(name).toLowerCase();
    if (files.has(key)) throw new UsageError(`blocks '${files.get(key)}' and '${name}' write the same output file ${safeName(name)}`);
    files.set(key, name);
  }
}
