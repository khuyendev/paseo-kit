// Line edits against read tags (FTOL-35..37, D-43): an edit names the tag and line numbers of a read_ranges entry
// instead of quoting oldText. It applies only where its lines and up to 2 context lines around them still read as
// shown: in place while the read is unchanged, else at the one place that matches (moved). Changed lines are never
// edited.
import { hashLine, NOT_RETAINED } from "./store.mjs";
import { fileKey, pathKey } from "./targets.mjs";
import { renderLines } from "./reader.mjs";

const CONTEXT = 2;
const SHOW_LINES = 20;
const MAX_LISTED = 10;
const MAX_PLACES = 20;

function sameFile(a, b) {
  try {
    return fileKey(a) === fileKey(b);
  } catch {
    return false;
  }
}

export const isLineEdit = (e) => e.from !== undefined || e.to !== undefined || e.after !== undefined;
const span = (a, b) => (a === b ? `line ${a}` : `lines ${a}-${b}`);
export const lineLabel = (e) => (e.after !== undefined ? `after line ${e.after}` : span(e.from, e.to ?? e.from));

export function skip(run, label, why, id) {
  run.skipped.push(`${label}: ${why}`);
  if (id) run.used.push(id);
}

// 1-based starts where the hashes W run in a row in H, at most MAX_PLACES + 1
function findRun(H, W) {
  const out = [];
  for (let j = 0; W.length && j + W.length <= H.length && out.length <= MAX_PLACES; j++) {
    let k = 0;
    while (k < W.length && H[j + k] === W[k]) k++;
    if (k === W.length) out.push(j + 1);
  }
  return out;
}

export const lineSig = (store, abs, e) => store.sign(abs, "line", e.tag, e.from, e.to, e.after, e.newText);

// Where line edit e applies in the current lines: { st, dc, lines, shift, sig } as a splice, or why not: { why } with
// { occurrences } (several places), { suggest } (edited lines alone, once), { shown } (tag of the current lines),
// { retag } (a new read is needed) or { skip }. pick: { at } or { occurrence, occurrences } of a fix.
function locate(store, p, cur, curH, e, pick) {
  if (e.oldText !== undefined) return { why: "give oldText or line numbers (from/to, after), not both" };
  if (!e.tag) return { retag: true, why: "a line edit needs the tag of the read_ranges entry that showed the lines, on the file entry" };
  const snap = store.read(e.tag);
  if (!snap) return { retag: true, why: `unknown tag ${e.tag} (expired, or from an earlier server process); read the lines again with read_ranges` };
  if (pathKey(snap.abs) !== pathKey(p.abs) && !sameFile(snap.abs, p.abs)) return { retag: true, why: `tag ${e.tag} is a read of ${snap.abs}, not of this file` };
  const insert = e.after !== undefined;
  const a = insert ? e.after + 1 : e.from;
  const b = insert ? e.after : e.to ?? e.from;
  const bad = insert
    ? !Number.isInteger(e.after) || e.after < 0 || e.from !== undefined || e.to !== undefined
    : !Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a;
  if (bad) return { why: "give whole line numbers: from (with to >= from), or after alone (0: at the top)" };
  const s = snap.from;
  const end = s + snap.hashes.length - 1;
  if (a < s || b > end) return { retag: true, why: `${lineLabel(e)} not inside read ${e.tag} (lines ${s}-${end}); read the lines first` };
  const lines = e.newText === "" ? [] : e.newText.replace(/\n$/, "").split("\n");
  if (insert && !lines.length) return { why: "newText is empty: nothing to insert" };
  const wa = Math.max(s, a - CONTEXT);
  const W = snap.hashes.slice(wa - s, Math.min(end, b + CONTEXT) - s + 1);
  const E = snap.hashes.slice(a - s, b - s + 1);
  const sig = lineSig(store, p.abs, e);
  const at = (shift) => ({ st: a - 1 + shift, dc: b - a + 1, lines, shift, sig });
  if (pick?.at) {
    return E.every((h, k) => curH[pick.at - 1 + k] === h)
      ? at(pick.at - a)
      : { retag: true, why: `the suggested ${span(pick.at, pick.at + E.length - 1)} changed again; read them again` };
  }
  if (cur.length === snap.total && snap.hashes.every((h, k) => curH[s - 1 + k] === h)) return at(0);
  const wrote = store.wasWritten(sig) || p.sigs.includes(sig);
  if (wrote && (!lines.length || findRun(curH, lines.map(hashLine)).length)) return { skip: true, why: "already applied: this session wrote this edit before" };
  const found = findRun(curH, W);
  const what = insert ? `the lines around line ${e.after}` : span(a, b);
  if (pick?.occurrence && found.length === pick.occurrences && pick.occurrence <= found.length) return at(found[pick.occurrence - 1] - wa);
  if (found.length === 1) return at(found[0] - wa);
  if (found.length > 1) {
    const where = found.slice(0, MAX_LISTED).map((j) => (insert ? `after ${j + a - wa - 1}` : j + a - wa)).join(", ");
    const n = found.length > MAX_PLACES ? `more than ${MAX_PLACES}` : found.length;
    return { occurrences: found.length, why: `the file changed since read ${e.tag}, and ${what} with the lines around them now occur ${n} times (lines ${where}${found.length > MAX_LISTED ? ", ..." : ""})` };
  }
  const done = [...W.slice(0, a - wa), ...lines.map(hashLine), ...W.slice(b + 1 - wa)];
  if (done.length > lines.length && findRun(curH, done).length === 1) return { skip: true, why: `already applied: the file reads as this edit leaves ${what}` };
  const hit = insert ? [] : findRun(curH, E);
  if (hit.length === 1) {
    return { suggest: hit[0], why: `the lines around ${what} changed since read ${e.tag}; the edited lines still read as shown at ${span(hit[0], hit[0] + E.length - 1)}, SUGGESTED there` };
  }
  const fa = Math.max(1, a - CONTEXT);
  const fb = Math.min(cur.length, b + CONTEXT);
  if (fa > fb || fb - fa + 1 > SHOW_LINES) return { retag: true, why: `${what} changed since read ${e.tag}; read them again` };
  const shownLines = cur.slice(fa - 1, fb);
  const shown = store.registerRead(p.abs, fa, shownLines, cur.length);
  return { shown, why: `${what} changed since read ${e.tag}; lines ${fa}-${fb} now read (tag ${shown}):\n${renderLines(fa, String(fb).length, shownLines)}\n` };
}

function lineFail(env, p, e, label, d, id) {
  const { store, run } = env;
  if (d.skip) return skip(run, label, d.why, id);
  const entry = { abs: p.abs, line: { tag: e.tag, from: e.from, to: e.to, after: e.after, newText: e.newText }, occurrences: d.occurrences, suggest: d.suggest, shown: d.shown };
  const fid = store.remember(entry, id);
  const nums = e.after !== undefined ? '"after":<line>' : '"from":<line>,"to":<line>';
  const form = d.suggest ? `{"id":"${fid}"}`
    : d.occurrences ? `{"id":"${fid}","occurrence":<1-${d.occurrences}>}`
      : d.shown ? `{"id":"${fid}",${nums}} with numbers as now shown`
        : d.retag ? `{"id":"${fid}","tag":"<tag of a new read_ranges>",${nums}}`
          : `{"id":"${fid}",${nums}}`;
  run.failed.push(`${fid} ${label}: ${d.why} → ${store.hasFix(fid) ? `fix: ${form}` : NOT_RETAINED}`);
  run.failedEdits++;
  p.failed++;
}

const overlapping = (x, y) => x.st < y.st + y.dc && (x.dc ? y.st < x.st + x.dc : y.st < x.st);

// The line edits of one file entry (or one fix): all placed against the same current text, then applied bottom-up
// so each keeps the numbering of its read (FTOL-36).
export function lineEdits(env, p, edits, labels, ids = [], pick) {
  const { store, run } = env;
  const cur = p.text.split("\n");
  const curH = cur.map(hashLine);
  const placed = [];
  edits.forEach((e, i) => {
    const r = locate(store, p, cur, curH, e, pick);
    if (!r.lines) return lineFail(env, p, e, labels[i], r, ids[i]);
    if (placed.some((q) => q.sig === r.sig)) return skip(run, labels[i], "already applied: the same edit is listed twice", ids[i]);
    const clash = placed.find((q) => (q.dc || r.dc) && (q.dc && r.dc ? overlapping(q, r) : q.dc ? overlapping(r, q) : overlapping(q, r)));
    if (clash) return lineFail(env, p, e, labels[i], { why: `overlaps edit ${clash.i + 1} ${lineLabel(edits[clash.i])}; give one edit for these lines` }, ids[i]);
    placed.push({ ...r, i, label: labels[i], id: ids[i] });
  });
  // bottom-up; at one line a replacement before the inserts there, and later inserts first so the list order stays
  placed.sort((x, y) => y.st - x.st || (y.dc > 0) - (x.dc > 0) || y.i - x.i);
  for (const r of placed) {
    cur.splice(r.st, r.dc, ...r.lines);
    p.applied++;
    p.sigs.push(r.sig, ...(edits[r.i].sigs ?? []));
    if (r.id) run.used.push(r.id);
    if (r.shift) run.moved.push(`${r.label}: its lines had moved ${r.shift > 0 ? "+" : ""}${r.shift}; applied from line ${r.st + 1}`);
  }
  p.text = cur.join("\n");
}

// A retained line failure retried by its fix (FTOL-37).
export function lineFix(env, p, id, entry, fx) {
  const edit = { ...entry.line };
  const label = `${entry.abs} retry ${lineLabel(entry.line)}`;
  if (fx.newText !== undefined) edit.newText = fx.newText.replace(/\r\n/g, "\n");
  const renumber = fx.from !== undefined || fx.to !== undefined || fx.after !== undefined;
  edit.sigs = [lineSig(env.store, p.abs, entry.line)]; // a later resend of the edit as first sent is a skip
  if (renumber) Object.assign(edit, { from: fx.from, to: fx.to, after: fx.after, tag: fx.tag ?? entry.shown ?? edit.tag });
  else if (fx.tag !== undefined) edit.tag = fx.tag;
  const pick = fx.occurrence !== undefined && entry.occurrences
    ? { occurrence: fx.occurrence, occurrences: entry.occurrences }
    : !renumber && fx.tag === undefined && entry.suggest ? { at: entry.suggest } : undefined;
  lineEdits(env, p, [edit], [label], [id], pick);
}
