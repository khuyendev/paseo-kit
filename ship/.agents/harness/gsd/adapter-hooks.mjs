// Adapter hooks (ADPT-15) and the adapter's ownership and verify vocabulary (ADPT-03, ADPT-04). Project specifics
// reach the core only through these (D-110); a broken hook makes the check unresolvable, never a pass (INV-36).
import fs from "node:fs";
import path from "node:path";
import { invokeHook } from "../adapter/hooks.mjs";

export class HookError extends Error {}

// One ADPT-15 request through the adapter's hook runner; a hook fault throws HookError (the check is unresolvable).
export async function callHook(g, script, op, request) {
  const r = await invokeHook(g.cfg, { codeRoot: g.codeRoot, script, op, ...request });
  if (!r.ok) throw new HookError(r.reason);
  return r.response;
}

// --- verify vocabulary ---

export const SENTINEL = /^MISSING\b/i;

// The kind of an <automated> text: longest registered prefix wins; a word prefix needs a word boundary.
export function classify(command, vocab) {
  const text = String(command ?? "").trim();
  if (SENTINEL.test(text)) return { kind: "sentinel", argument: text };
  const kinds = Object.entries(vocab).sort((a, b) => b[1].prefix.length - a[1].prefix.length);
  for (const [kind, spec] of kinds) {
    const p = spec.prefix;
    if (!text.startsWith(p)) continue;
    if (/\w$/.test(p) && /^\w/.test(text.slice(p.length))) continue;
    return { kind, argument: text.slice(p.length).trim(), spec };
  }
  return { kind: "unknown", argument: text };
}

const PATH_LIKE = /^(?!-)(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[\w]+$|^(?!-)[\w@.-]+(?:\/[\w@.-]+)+\/?$/;

export const firstPathToken = (argument) =>
  String(argument)
    .split(/\s+/)
    .map((t) => t.replace(/^["']|["']$/g, ""))
    .find((t) => PATH_LIKE.test(t)) ?? null;

export async function targetsOf(g, kind, spec, argument) {
  if (spec?.parser) return (await callHook(g, spec.parser, "parse", { kind, argument })).targets;
  return argument.trim() ? [argument.trim()] : [];
}

// The core's own resolver for a kind without one (the default `cmd`): its first path-like token.
export function builtinResolve(g, argument, plan) {
  const target = firstPathToken(argument);
  if (!target) return [{ target: argument, status: "unresolvable", detail: "no path-like token to resolve" }];
  const norm = target.replace(/^\.\//, "");
  if (fs.existsSync(path.resolve(g.codeRoot, norm))) return [{ target: norm, status: "ok" }];
  if (plan.filesModified.some((f) => f.replace(/^\.\//, "") === norm)) return [{ target: norm, status: "pending_creation" }];
  return [{ target: norm, status: "missing" }];
}

// --- ownership ---

const GLOB_CHARS = /[*?[{]/;
const WIN = process.platform === "win32";
const fold = (s) => (WIN ? s.toLowerCase() : s);

// A repo-relative path in canonical form (slashes, no dot segments, no leading ./); null when it is absolute or
// leaves the code root. Ownership compares pathKey so case aliases on Windows are one file (GSDC-23, INV-52).
export function repoPath(p) {
  const s = String(p ?? "").trim().replace(/\\/g, "/");
  if (!s || s.startsWith("/") || /^[A-Za-z]:/.test(s)) return null;
  const n = path.posix.normalize(s).replace(/^(\.\/)+/, "").replace(/\/$/, "");
  if (n === ".." || n.startsWith("../")) return null;
  return n === "." ? "" : n;
}

export const pathKey = (p) => {
  const r = repoPath(p);
  return r === null ? null : fold(r);
};

// The physical repo path of p (links and junctions in its deepest existing ancestor resolved); null outside the root.
export function physicalPath(codeRoot, p) {
  const r = repoPath(p);
  if (r === null) return null;
  const realRoot = fs.realpathSync.native(codeRoot);
  const parts = r ? r.split("/") : [];
  for (let i = parts.length; i >= 0; i--) {
    let real;
    try {
      real = fs.realpathSync.native(path.join(codeRoot, ...parts.slice(0, i)));
    } catch {
      continue;
    }
    const relp = path.relative(realRoot, real);
    if (relp === ".." || relp.startsWith(`..${path.sep}`) || path.isAbsolute(relp)) return null;
    return [relp.split(path.sep).join("/"), ...parts.slice(i)].filter(Boolean).join("/");
  }
  return null;
}

// An owns entry -> repo path or glob through `adapter.ownership.owns_forms`; null when no form matches.
export function ownsPath(entry, forms) {
  const s = String(entry).trim();
  for (const form of forms) {
    if (!s.startsWith(form.prefix)) continue;
    const rest = s.slice(form.prefix.length).trim().replace(/^\.\//, "").replace(/\\/g, "/");
    if (!rest || rest.includes("..") || path.isAbsolute(rest)) return null;
    const mapped = form.maps_to.replace("<path>", rest);
    return GLOB_CHARS.test(mapped) ? mapped : repoPath(mapped) || null;
  }
  return null;
}

const base = (glob) => {
  const parts = glob.split("/");
  const i = parts.findIndex((p) => GLOB_CHARS.test(p));
  return (i < 0 ? parts : parts.slice(0, i)).join("/");
};

export function covers(owned, file) {
  const f = pathKey(file);
  if (f === null) return false;
  if (GLOB_CHARS.test(owned)) {
    const gl = fold(String(owned).replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, ""));
    return path.posix.matchesGlob(f, gl) || path.posix.matchesGlob(f, `${gl}/**`);
  }
  const o = pathKey(owned);
  if (o === null) return false;
  return o === "" || f === o || f.startsWith(`${o}/`);
}

export function overlaps(a, b) {
  const ba = base(a).replace(/\/$/, "");
  const bb = base(b).replace(/\/$/, "");
  return ba === "" || bb === "" || pathKey(ba) === pathKey(bb) || covers(a, bb) || covers(b, ba) || covers(ba, bb) || covers(bb, ba);
}

export const matchesShared = (file, globs) => {
  const f = pathKey(file);
  return f !== null && globs.some((gl) => path.posix.matchesGlob(f, fold(gl)));
};

// Existing files below an owned path (bounded walk) so an owns prefix covering a shared file is caught.
export function filesUnder(codeRoot, owned, limit = 5000) {
  const start = path.resolve(codeRoot, base(owned) || ".");
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= limit || depth > 8) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === ".git" || e.name === "node_modules") continue;
      const abs = path.join(dir, e.name);
      const relp = path.relative(codeRoot, abs).split(path.sep).join("/");
      if (e.isDirectory()) walk(abs, depth + 1);
      else if (covers(owned, relp)) out.push(relp);
    }
  };
  try {
    if (fs.statSync(start).isFile()) return covers(owned, path.relative(codeRoot, start).split(path.sep).join("/")) ? [path.relative(codeRoot, start).split(path.sep).join("/")] : [];
  } catch {
    return [];
  }
  walk(start, 0);
  return out;
}

// Paths the adapter declares shared (orchestrator-only): globs plus the optional predicate hook.
export async function sharedPaths(g, paths) {
  const own = g.cfg.adapter.ownership.shared;
  const hit = new Set(paths.filter((p) => matchesShared(p, own.globs)));
  if (own.predicate && paths.length) for (const p of (await callHook(g, own.predicate, "shared", { paths })).shared) hit.add(p);
  return hit;
}
