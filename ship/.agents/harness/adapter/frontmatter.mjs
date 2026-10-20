// Front matter of skills and agent definitions: the YAML subset the kit documents (PHCL-26): `key: scalar`
// (quotes allowed), lists as `- item` lines or flow `[a, b]`, `#` comments at line start or after whitespace.

function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "#" && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

const unquote = (v) => (/^(["']).*\1$/.test(v) ? v.slice(1, -1) : v);

function scalarOrList(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    return v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
  }
  return unquote(v);
}

// Returns {data, keys, body, bodyLine (1-based line of the body start)} or {error}. No front matter -> data null.
export function parseFrontMatter(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return { data: null, keys: [], body: lines.join("\n"), bodyLine: 1 };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { error: "front matter has no closing ---" };
  const data = {};
  const keys = [];
  let listKey = null;
  for (let i = 1; i < end; i++) {
    const line = stripComment(lines[i]);
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s*(.*)$/) ?? line.match(/^-\s*(.*)$/);
    if (item && listKey) {
      data[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) return { error: `front matter line ${i + 1} is not 'key: value'` };
    const [, key, value] = kv;
    keys.push(key);
    if (value.trim() === "") {
      data[key] = [];
      listKey = key;
    } else {
      data[key] = scalarOrList(value);
      listKey = null;
    }
  }
  return { data, keys, body: lines.slice(end + 1).join("\n"), bodyLine: end + 2 };
}

// A list-or-string field as a list of tokens (`tools: Read, Edit` and `tools: [Read, Edit]` alike).
export function tokens(value) {
  if (Array.isArray(value)) return value.flatMap((v) => tokens(v));
  return String(value ?? "").split(/[\s,]+/).filter(Boolean);
}
