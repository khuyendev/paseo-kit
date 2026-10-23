// All-or-nothing commit of whole-file texts (FTOL-27): stage temps beside the targets, rename over them, and on a
// failure restore what was replaced. "nothing written" is claimed only when the rollback completed. With a journal
// the originals and temp names are stored before the first rename, so a process killed mid-batch, where no catch
// runs, is rolled back by recoverCommit at the next ticket; the journal goes once the batch is done or undone.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PRIVATE, readPrivate, writePrivate } from "./private.mjs";

const RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

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

// puts back what a batch replaced: the original bytes, or no file at all when the batch created it
function restore(io, d) {
  if (d.original) {
    const replaced = io.statSync(d.abs).mtimeMs;
    io.writeFileSync(d.abs, d.original);
    restoreMtime(io, d.abs, d.mtimeMs, replaced);
  } else io.rmSync(d.abs, { force: true });
}

// CR-FIL-01: creating a folder does not own what another writer put in it since; only empty ones go, deepest first
function removeEmptyDirs(io, dirs) {
  for (const dir of [...new Set(dirs)].sort((a, b) => b.length - a.length)) {
    try {
      io.rmdirSync(dir);
    } catch { /* not empty or gone: left as is */ }
  }
}

// plan: [{abs, text}] with distinct paths; io: the fs functions used (tests inject faults); journal: { file, ticket,
// method } of the backend ticket, written before the first rename when given
export function commitFiles(plan, io = fs, journal = null) {
  const staged = [];
  const createdDirs = [];
  const cleanTemps = () => staged.forEach((s) => io.rmSync(s.tmp, { force: true }));
  const cleanDirs = () => removeEmptyDirs(io, createdDirs);
  let current;
  try {
    // originals and temp names first, before any temp is written, so the journal can list them
    for (const p of plan) {
      current = p.abs;
      // the folders this call creates, each one (mkdirSync reports only the first, in long-path form on Windows)
      for (let dir = path.dirname(p.abs); !io.existsSync(dir) && path.dirname(dir) !== dir; dir = path.dirname(dir)) createdDirs.push(dir);
      io.mkdirSync(path.dirname(p.abs), { recursive: true });
      let original = null, mode, mtimeMs = 0;
      if (io.existsSync(p.abs)) {
        const stat = io.statSync(p.abs);
        original = io.readFileSync(p.abs);
        mode = stat.mode & 0o7777;
        mtimeMs = stat.mtimeMs;
      }
      const tmp = `${p.abs}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      staged.push({ ...p, tmp, original, mode, mtimeMs });
    }
    if (journal) {
      const record = {
        ticket: journal.ticket,
        method: journal.method,
        dirs: createdDirs,
        entries: staged.map((s) => ({
          abs: s.abs,
          tmp: s.tmp,
          original: s.original?.toString("base64") ?? null,
          before: s.original && sha256(s.original),
          after: sha256(s.text),
          mtimeMs: s.mtimeMs,
        })),
      };
      if (JSON.stringify(record).length > PRIVATE.maxFileBytes) throw new Error("the original texts are too large to journal");
      writePrivate(journal.file, record);
    }
    for (const s of staged) {
      current = s.abs;
      io.writeFileSync(s.tmp, s.text, { encoding: "utf8", flag: "wx" });
      if (s.mode !== undefined && process.platform !== "win32") io.chmodSync(s.tmp, s.mode);
    }
  } catch (e) {
    cleanTemps();
    cleanDirs();
    if (journal) io.rmSync(journal.file, { force: true });
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
          restore(io, d);
        } catch (r) {
          incomplete.push(`${d.abs} (${r.message})`);
        }
      }
      cleanTemps();
      if (journal) io.rmSync(journal.file, { force: true });
      if (incomplete.length) throw new Error(`writing ${s.abs} failed (${e.message}); ROLLBACK INCOMPLETE, these files may hold the new text: ${incomplete.join("; ")}`);
      cleanDirs();
      throw new Error(`nothing written: writing ${s.abs} failed (${e.message}); ${done.length} file(s) already replaced were restored`);
    }
  }
  if (journal) io.rmSync(journal.file, { force: true }); // complete: a kill from here on needs no rollback
}

// After a kill nothing else runs, so the journal is the record of a batch's changes. A target still at its original text
// is left alone; one at the batch's new text is put back; one changed since the kill is left as it is and reported.
// Then the temps and the folders the batch created go, and the journal too. Returns the ticket and what is incomplete.
export function recoverCommit(file, io = fs) {
  const journal = readPrivate(file);
  const incomplete = [];
  for (const e of journal.entries) {
    try {
      const now = io.existsSync(e.abs) ? sha256(io.readFileSync(e.abs)) : null;
      if (now === e.before) continue;
      if (now !== e.after) incomplete.push(`${e.abs} (changed since the interruption, left as it is)`);
      else restore(io, { abs: e.abs, original: e.original === null ? null : Buffer.from(e.original, "base64"), mtimeMs: e.mtimeMs });
    } catch (r) {
      incomplete.push(`${e.abs} (${r.message})`);
    }
  }
  for (const e of journal.entries) io.rmSync(e.tmp, { force: true });
  removeEmptyDirs(io, journal.dirs);
  io.rmSync(file, { force: true });
  return { ticket: journal.ticket, method: journal.method, incomplete };
}
