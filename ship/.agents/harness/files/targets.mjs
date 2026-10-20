// Target path resolution of the file tools (FTOL-18): session cwd, Git Bash drive form, `~`, canonical realpaths.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const WIN = process.platform === "win32";

// Map key of a path: case-folded only on Windows (on POSIX A.txt and a.txt are distinct targets).
export const pathKey = (p) => (WIN ? p.toLowerCase() : p);

// a Git Bash path (/c/Users/...) as the Windows path it names; any other path unchanged
export const nativePath = (p) => (WIN && /^\/[a-z](\/|$)/i.test(p) ? `${p[1].toUpperCase()}:${p.slice(2) || "/"}` : p);

export function within(p, root) {
  const rel = path.relative(pathKey(path.resolve(root)), pathKey(path.resolve(p)));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

// `~` expands from the same home in plan and execution: both run in the native Bash call's environment.
export function absolutePath(value, cwd) {
  if (typeof value !== "string" || !value) throw new Error("path must be a nonempty string");
  const home = os.homedir();
  const expanded = value === "~" ? home : /^~[/\\]/.test(value) ? path.join(home, value.slice(2)) : value;
  return path.resolve(cwd, nativePath(expanded));
}

// The realpath of the deepest existing ancestor plus the missing rest: catches symlinked parents of new files.
export function canonicalPath(abs) {
  const rest = [];
  for (let ancestor = abs; ; ) {
    try {
      return path.join(fs.realpathSync.native(ancestor), ...rest.reverse());
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error.code) || path.dirname(ancestor) === ancestor) throw error;
      let link = false;
      try {
        link = fs.lstatSync(ancestor).isSymbolicLink();
      } catch { /* missing: an ordinary new path segment */ }
      if (link) throw new Error(`broken symlink: ${ancestor}`);
      rest.push(path.basename(ancestor));
      ancestor = path.dirname(ancestor);
    }
  }
}

// The physical file of abs: two spellings through a junction or symlink are one file (CR-FIL-02).
export const fileKey = (abs) => pathKey(canonicalPath(abs));

export const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

export const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
