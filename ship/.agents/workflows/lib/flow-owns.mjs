// Ownership and SUMMARY helpers shared by the execute plumbing.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { sha256 } from "../../harness/lib/hash.mjs";
import { toSlash } from "../../harness/lib/paths.mjs";
import { frontmatter } from "../../harness/gsd/yaml.mjs";

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
  return ownsDepth(rel, owns, prefixes) >= 0;
}

// Length of the most specific owns entry that covers the path (-1 when none does): `Path:lib/a/` covers lib/a/x.js
// with depth 5, `lib/a/x.js` itself with depth 10.
export function ownsDepth(rel, owns, prefixes) {
  const p = toSlash(rel).replace(/^\.\//, "");
  let best = -1;
  for (const entry of owns) {
    const o = ownsPath(entry, prefixes);
    if (!o) continue;
    const hit = o.endsWith("/") ? p.startsWith(o) : p === o || p.startsWith(`${o}/`);
    if (hit) best = Math.max(best, o.replace(/\/$/, "").length);
  }
  return best;
}

// The plans owning a path through their most specific owns entry: a plan owning a parent directory gives way to the
// plan owning a deeper directory or the file (nested owns across waves, kit-feedback 29/31). Equally specific owners
// are all returned, so a real tie still reads as ambiguous.
export function specificOwners(rel, plans, prefixes, ownsOf = (p) => p.owns ?? []) {
  let best = -1;
  let out = [];
  for (const p of plans) {
    const d = ownsDepth(rel, ownsOf(p), prefixes);
    if (d < 0 || d < best) continue;
    if (d > best) { best = d; out = []; }
    out.push(p);
  }
  return out;
}

export function contentHash(abs) {
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? sha256(fs.readFileSync(abs)) : "deleted";
}

// SUMMARY frontmatter `key-files: {created: [...], modified: [...]}` in block or flow form, read with the kit's
// GSDC-05 parser (quoted paths holding commas, flow lists wrapped over several lines).
export function keyFiles(text) {
  const kf = frontmatter(String(text ?? "")).fm?.["key-files"] ?? frontmatter(String(text ?? "")).fm?.key_files;
  const list = (v) => (Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v]).map((s) => clean(String(s))).filter(Boolean);
  return { created: list(kf?.created), modified: list(kf?.modified) };
}

const clean = (s) => s.trim().replace(/^[`]|[`]$/g, "").replace(/\s+#.*$/, "");

export const relFrom = (root, abs) => toSlash(path.relative(root, abs));
