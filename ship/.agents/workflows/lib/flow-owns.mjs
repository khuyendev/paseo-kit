// Ownership and SUMMARY helpers shared by the execute plumbing.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { toSlash } from "../../harness/lib/paths.mjs";

// An owns entry is a path or directory, optionally in an adapter owns form (`Path:<path>`, ADPT-04).
export function ownsPrefixes(root) {
  try {
    return loadConfig(root).adapter.ownership.owns_forms.map((f) => f.prefix).filter(Boolean);
  } catch {
    return ["Path:"];
  }
}

export function ownsPath(entry, prefixes) {
  let p = String(entry).trim().replace(/^`|`$/g, "");
  for (const pre of prefixes) if (p.startsWith(pre)) { p = p.slice(pre.length).trim(); break; }
  return toSlash(p).replace(/^\.\//, "");
}

export function owned(rel, owns, prefixes) {
  const p = toSlash(rel).replace(/^\.\//, "");
  return owns.some((entry) => {
    const o = ownsPath(entry, prefixes);
    if (!o) return false;
    if (o.endsWith("/")) return p.startsWith(o);
    return p === o || p.startsWith(`${o}/`);
  });
}

export function contentHash(abs) {
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? sha256(fs.readFileSync(abs)) : "deleted";
}

// SUMMARY frontmatter `key-files: {created: [...], modified: [...]}` in block or flow form.
export function keyFiles(text) {
  const fm = /^(?:﻿)?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const result = { created: [], modified: [] };
  if (!fm) return result;
  let inKeyFiles = false;
  let list = null;
  for (const line of fm[1].split(/\r?\n/)) {
    if (/^key[-_]files:/.test(line)) { inKeyFiles = true; continue; }
    if (inKeyFiles && /^\S/.test(line)) break;
    if (!inKeyFiles) continue;
    const field = /^\s+(created|modified):\s*(.*)$/.exec(line);
    if (field) {
      list = result[field[1]];
      const flow = /^\[(.*)\]$/.exec(field[2].trim());
      if (flow) list.push(...flow[1].split(",").map(clean).filter(Boolean));
      continue;
    }
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list) list.push(clean(item[1]));
  }
  return result;
}

const clean = (s) => s.trim().replace(/^["'`]|["'`]$/g, "").replace(/\s+#.*$/, "");

export const relFrom = (root, abs) => toSlash(path.relative(root, abs));
