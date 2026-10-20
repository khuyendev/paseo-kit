// Agent definitions: `.agents/agents/<type>.md` with a small documented front-matter subset (PHCL-26, PHCL-27).
//
// Front matter subset: the block between a first line `---` and the next `---`; one `key: value` per line; values are
// plain scalars, 'single' or "double" quoted scalars, flow lists `[a, b]`, or (empty value) the `- item` lines that
// follow; a `#` starts a comment at line start or after whitespace outside quotes; anything else is ignored.
import fs from "node:fs";
import path from "node:path";
import { READ_ONLY_DENIED_TOOLS } from "../paseo-client/index.mjs";
import { UsageError } from "../lib/cli.mjs";
import { sha256 } from "../lib/hash.mjs";
import { readText } from "../lib/io.mjs";
import { isInside, toSlash } from "../lib/paths.mjs";

export const AGENTS_DIR = ".agents/agents";

function stripComment(text) {
  const m = /(^|\s)#/.exec(text);
  return (m ? text.slice(0, m.index) : text).trim();
}

function scalar(raw) {
  const text = raw.trim();
  const quote = text[0];
  if (quote === '"' || quote === "'") {
    let out = "";
    for (let i = 1; i < text.length; i++) {
      const ch = text[i];
      if (quote === "'" && ch === "'" && text[i + 1] === "'") {
        out += "'";
        i++;
      } else if (quote === '"' && ch === "\\" && i + 1 < text.length) {
        out += text[++i];
      } else if (ch === quote) {
        return out;
      } else {
        out += ch;
      }
    }
    return out;
  }
  return stripComment(text);
}

function flowList(text) {
  const inner = stripComment(text.replace(/\]\s*(#.*)?$/, "")).replace(/^\[/, "");
  return inner.split(",").map((item) => scalar(item)).filter((item) => item !== "");
}

export function splitFrontMatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines[0].trim() !== "---") return { meta: {}, body: text };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end < 0) return { meta: {}, body: text };
  return { meta: parseFrontMatter(lines.slice(1, end)), body: lines.slice(end + 1).join("\n") };
}

export function parseFrontMatter(lines) {
  const meta = {};
  let last = null;
  for (const line of lines) {
    if (/^\s*(#|$)/.test(line)) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && last) {
      if (!Array.isArray(meta[last])) meta[last] = meta[last] ? [meta[last]] : [];
      const value = scalar(item[1]);
      if (value !== "") meta[last].push(value);
      continue;
    }
    const pair = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!pair) continue;
    last = pair[1];
    const raw = pair[2].trim();
    meta[last] = raw.startsWith("[") ? flowList(raw) : scalar(raw);
  }
  return meta;
}

const asList = (value) => (Array.isArray(value) ? value : String(value ?? "").split(",")).map((v) => v.trim()).filter(Boolean);

// Token match, so `mcp__harness-files__edit_multiple_files` counts as an editing tool and `ReadEdits` would not.
export function isReadOnlyTools(tools) {
  if (tools === undefined || tools === null || (Array.isArray(tools) ? !tools.length : !String(tools).trim())) return false;
  const tokens = new Set(asList(tools).flatMap((t) => t.split(/[\s()[\]"']+/)).filter(Boolean));
  return !READ_ONLY_DENIED_TOOLS.some((tool) => tokens.has(tool));
}

export function checkAgentType(type) {
  if (!/^[A-Za-z0-9._-]+$/.test(type) || type.includes("..")) throw new UsageError(`invalid agent type '${type}' (letters, digits, . _ - only)`);
}

export function loadAgentDef(root, type) {
  checkAgentType(type);
  const file = path.join(root, AGENTS_DIR, `${type}.md`);
  if (!fs.existsSync(file)) throw new UsageError(`agent type '${type}' not found: ${file}`);
  const { meta, body } = splitFrontMatter(readText(file));
  const includes = asList(meta.include).map((rel) => {
    const abs = path.resolve(root, rel);
    if (!isInside(abs, root) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new UsageError(`agent type '${type}' includes a missing file: ${rel}`);
    }
    return { rel: toSlash(rel), text: splitFrontMatter(readText(abs)).body.trim() };
  });
  const model = typeof meta.model === "string" && meta.model && meta.model !== "inherit" ? meta.model : null;
  const def = {
    type,
    name: meta.name ?? type,
    description: meta.description ?? "",
    tools: meta.tools === undefined ? null : asList(meta.tools).join(", "),
    model,
    body: body.trim(),
    includes,
    readOnly: isReadOnlyTools(meta.tools),
  };
  // The role text as the agent sees it; its hash keys the workflow resume cache (FLOW-15).
  def.roleHash = sha256(JSON.stringify([def.body, includes.map((i) => [i.rel, i.text])]));
  return def;
}

export function listAgentTypes(root) {
  const dir = path.join(root, AGENTS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
}
