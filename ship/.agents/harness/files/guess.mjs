// The file an agent most likely meant when a path it gave does not exist (FTOL-19, D-44): most failed reads were
// the right file name in the wrong folder. Names match case-insensitively on every platform.
import fs from "node:fs";
import path from "node:path";
import { isDir, within } from "./targets.mjs";

export const GUESS = Object.freeze({ maxEntries: 20000, maxListed: 5, skipDirs: new Set(["node_modules", ".git"]) });

const lower = (s) => s.toLowerCase();

// { unique?: abs, candidates: [abs] } for a missing absolute path; the search widens only inside `root`
export function guessPath(abs, root) {
  const name = lower(path.basename(abs));
  const budget = { n: 0 };
  const done = new Set();
  let dir = path.dirname(abs);
  while (!isDir(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  if (path.dirname(dir) === dir) return { candidates: [] }; // only a drive root exists: too wide to search
  for (let d = dir; ; d = path.dirname(d)) {
    const hits = [];
    find(d, name, root, hits, budget, done);
    if (hits.length) {
      hits.sort((a, b) => shared(b, abs) - shared(a, abs) || a.length - b.length);
      const unique = hits.length === 1 && budget.n <= GUESS.maxEntries;
      return unique ? { unique: hits[0], candidates: hits } : { candidates: hits.slice(0, GUESS.maxListed) };
    }
    const up = path.dirname(d);
    if (up === d || !within(up, root) || budget.n > GUESS.maxEntries) break;
  }
  return { candidates: lookAlike(dir, name, root) };
}

// walks and names only what is inside `root`: a folder outside it is listed for its in-root entries only
function find(dir, name, root, hits, budget, done) {
  if (done.has(dir) || budget.n > GUESS.maxEntries) return;
  done.add(dir); // a wider search skips the folders a narrower one already walked
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (++budget.n > GUESS.maxEntries) return;
    const p = path.join(dir, e.name);
    if (!within(p, root)) continue;
    if (e.isDirectory()) {
      if (!GUESS.skipDirs.has(e.name)) find(p, name, root, hits, budget, done);
    } else if (lower(e.name) === name) hits.push(p);
  }
}

function shared(a, b) {
  const x = lower(a).split(/[\\/]/);
  const y = lower(b).split(/[\\/]/);
  let n = 0;
  while (n < x.length && x[n] === y[n]) n++;
  return n;
}

function lookAlike(dir, name, root) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const limit = Math.max(2, Math.floor(name.length / 4));
  return names
    .map((n) => ({ n, d: distance(lower(n), name) }))
    .filter((x) => x.d <= limit && within(path.join(dir, x.n), root))
    .sort((a, b) => a.d - b.d)
    .slice(0, GUESS.maxListed)
    .map((x) => path.join(dir, x.n));
}

function distance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
