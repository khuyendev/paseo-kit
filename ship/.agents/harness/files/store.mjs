// Session-bound edit state (FTOL-31, FTOL-32, FTOL-34): retained fix IDs, read tags with per-line hashes, and
// signatures of committed edits. Plain JSON in the session's private state.json, loaded and saved under its lock.
import crypto from "node:crypto";
import { pathKey } from "./targets.mjs";

export const LIMITS = Object.freeze({
  keepFixes: 500,
  fixBytes: 8 * 1024 * 1024,
  keepReads: 64,
  keepLines: 30000,
  keepWritten: 2000,
});

export const NOT_RETAINED = "not retained: this replacement exceeds the 8 MiB failure-state budget; resend a smaller edit";

// FNV-1a over UTF-16 code units of a CR-stripped line
export const hashLine = (s) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
};

const runLetters = () => String.fromCharCode(97 + crypto.randomInt(26), 97 + crypto.randomInt(26));

export function createStore(state = {}) {
  const run = state.run ?? runLetters();
  let nextFix = state.nextFix ?? 1;
  let nextRead = state.nextRead ?? 1;
  const fixes = new Map(state.fixes ?? []);
  const fixSize = new Map([...fixes].map(([id, e]) => [id, Buffer.byteLength(JSON.stringify(e))]));
  let fixBytes = [...fixSize.values()].reduce((a, b) => a + b, 0);
  const reads = new Map(state.reads ?? []);
  const written = new Map(state.written ?? []);

  const dropFix = (id) => {
    if (!fixes.has(id)) return;
    fixBytes -= fixSize.get(id);
    fixes.delete(id);
    fixSize.delete(id);
  };

  return {
    // a fix ID for `entry`; reusing `id` re-retains a failed fix under its old ID. has(id) is false when not retained.
    remember(entry, id = `${run}${nextFix++}`) {
      dropFix(id);
      const size = Buffer.byteLength(JSON.stringify(entry));
      if (size > LIMITS.fixBytes) return id;
      fixes.set(id, entry);
      fixSize.set(id, size);
      fixBytes += size;
      while (fixes.size > LIMITS.keepFixes || fixBytes > LIMITS.fixBytes) dropFix(fixes.keys().next().value);
      return id;
    },
    fix: (id) => fixes.get(id),
    hasFix: (id) => fixes.has(id),
    consume: (id) => dropFix(id),
    fixCount: () => fixes.size,

    registerRead(abs, from, lines, total) {
      const tag = `${run}t${nextRead++}`;
      reads.set(tag, { abs, from, total, hashes: lines.map(hashLine) });
      let kept = 0;
      for (const s of reads.values()) kept += s.hashes.length;
      for (const [t, s] of reads) {
        if (t === tag || (reads.size <= LIMITS.keepReads && kept <= LIMITS.keepLines)) break;
        reads.delete(t);
        kept -= s.hashes.length;
      }
      return tag;
    },
    dropRead: (tag) => reads.delete(tag),
    read: (tag) => reads.get(tag),

    sign: (abs, ...parts) => crypto.createHash("sha1").update([pathKey(abs), ...parts].map(String).join("\0")).digest("hex").slice(0, 16),
    wasWritten: (sig) => written.has(sig),
    recordWritten(sigs) {
      for (const sig of sigs) {
        written.delete(sig);
        written.set(sig, 1);
      }
      while (written.size > LIMITS.keepWritten) written.delete(written.keys().next().value);
    },

    snapshot: () => ({ run, nextFix, fixes: [...fixes], nextRead, reads: [...reads], written: [...written] }),
  };
}
