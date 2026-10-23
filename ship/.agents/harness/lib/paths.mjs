// Path helpers for Windows and POSIX: case-insensitive comparison on win32, containment without the sibling-prefix bug.
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "./cli.mjs";

const fold = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));

export const toSlash = (p) => String(p).split(path.sep).join("/");

export const samePath = (a, b) => fold(a) === fold(b);

export function isInside(child, parent) {
  const rel = path.relative(fold(parent), fold(child));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

export function resolveInside(root, rel) {
  const abs = path.resolve(root, rel);
  if (!isInside(abs, root)) throw new UsageError(`${rel} is outside ${root}`);
  return abs;
}

// True when the real location of an existing rel (links followed) is inside the real location of root.
export function realInside(root, rel) {
  try {
    return isInside(fs.realpathSync.native(path.resolve(root, rel)), fs.realpathSync.native(root));
  } catch {
    return false;
  }
}

export const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, "_");

export const id8 = (id) => String(id ?? "?").slice(0, 8);
