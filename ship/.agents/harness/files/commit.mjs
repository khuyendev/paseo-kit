// All-or-nothing commit of whole-file texts (FTOL-27): stage temps beside the targets, rename over them, and on a
// failure restore what was replaced. "nothing written" is claimed only when the rollback completed.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// a scanner or editor briefly holding the file (Windows)
function renameRetry(io, from, to) {
  for (let i = 0; ; i++) {
    try {
      return io.renameSync(from, to);
    } catch (e) {
      if (i >= 5 || !RETRY_CODES.has(e.code)) throw e;
      pause(40 * 2 ** i);
    }
  }
}

// INV-54: a restored file must not keep a stat that git's index cache takes for unchanged, so its mtime moves to a
// later whole second than both its pre-call mtime and the replacement's.
function restoreMtime(io, abs, before, replaced) {
  const seconds = Math.floor(Math.max(before, replaced) / 1000) + 1;
  io.utimesSync(abs, seconds, seconds);
}

// plan: [{abs, text}] with distinct paths; io: the fs functions used (tests inject faults)
export function commitFiles(plan, io = fs) {
  const staged = [];
  const createdDirs = [];
  const cleanTemps = () => staged.forEach((s) => io.rmSync(s.tmp, { force: true }));
  const cleanDirs = () => {
    for (const dir of createdDirs.reverse()) {
      try {
        io.rmSync(dir, { recursive: true });
      } catch { /* left as is: an empty folder, no file content */ }
    }
  };
  let current;
  try {
    for (const p of plan) {
      current = p.abs;
      const made = io.mkdirSync(path.dirname(p.abs), { recursive: true });
      if (made) createdDirs.push(made);
      let original = null, mode, mtimeMs = 0;
      if (io.existsSync(p.abs)) {
        const stat = io.statSync(p.abs);
        original = io.readFileSync(p.abs);
        mode = stat.mode & 0o7777;
        mtimeMs = stat.mtimeMs;
      }
      const tmp = `${p.abs}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      staged.push({ ...p, tmp, original, mtimeMs });
      io.writeFileSync(tmp, p.text, { encoding: "utf8", flag: "wx" });
      if (mode !== undefined && process.platform !== "win32") io.chmodSync(tmp, mode);
    }
  } catch (e) {
    cleanTemps();
    cleanDirs();
    throw new Error(`nothing written: staging ${current} failed: ${e.message}`);
  }
  const done = [];
  for (const s of staged) {
    try {
      renameRetry(io, s.tmp, s.abs);
      done.push(s);
    } catch (e) {
      const incomplete = [];
      for (const d of done.reverse()) {
        try {
          if (d.original) {
            const replaced = io.statSync(d.abs).mtimeMs;
            io.writeFileSync(d.abs, d.original);
            restoreMtime(io, d.abs, d.mtimeMs, replaced);
          } else io.rmSync(d.abs, { force: true });
        } catch (r) {
          incomplete.push(`${d.abs} (${r.message})`);
        }
      }
      cleanTemps();
      if (incomplete.length) throw new Error(`writing ${s.abs} failed (${e.message}); ROLLBACK INCOMPLETE, these files may hold the new text: ${incomplete.join("; ")}`);
      cleanDirs();
      throw new Error(`nothing written: writing ${s.abs} failed (${e.message}); ${done.length} file(s) already replaced were restored`);
    }
  }
}
