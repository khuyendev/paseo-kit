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

// An owns entry -> repo path or glob through `adapter.ownership.owns_forms`; null when no form matches.
export function ownsPath(entry, forms) {
  const s = String(entry).trim();
  for (const form of forms) {
    if (!s.startsWith(form.prefix)) continue;
    const rest = s.slice(form.prefix.length).trim().replace(/^\.\//, "").replace(/\\/g, "/");
    if (!rest || rest.includes("..") || path.isAbsolute(rest)) return null;
    return form.maps_to.replace("<path>", rest);
  }
  return null;
}

const base = (glob) => {
  const parts = glob.split("/");
  const i = parts.findIndex((p) => GLOB_CHARS.test(p));
  return (i < 0 ? parts : parts.slice(0, i)).join("/");
};

export function covers(owned, file) {
  const f = file.replace(/\\/g, "/").replace(/^\.\//, "");
  if (GLOB_CHARS.test(owned)) return path.posix.matchesGlob(f, owned) || path.posix.matchesGlob(f, `${owned.replace(/\/$/, "")}/**`);
  const o = owned.replace(/\/$/, "");
  return f === o || f.startsWith(`${o}/`);
}

export function overlaps(a, b) {
  const ba = base(a).replace(/\/$/, "");
  const bb = base(b).replace(/\/$/, "");
  return ba === bb || ba === "" || bb === "" || covers(a, bb) || covers(b, ba) || covers(ba, bb) || covers(bb, ba);
}

export const matchesShared = (file, globs) => globs.some((gl) => path.posix.matchesGlob(file.replace(/\\/g, "/"), gl));

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
