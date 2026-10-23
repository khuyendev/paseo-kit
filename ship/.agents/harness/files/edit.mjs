// edit_multiple_files and write_multiple_files (FTOL-26..33): exact-once replacements, line edits, retained fix IDs,
// resent-edit detection, atomic and dryRun. Replies are summaries, never diffs (FTOL-28).
import fs from "node:fs";
import { commitFiles } from "./commit.mjs";
import { guessPath } from "./guess.mjs";
import { isLineEdit, lineEdits, lineFix, lineLabel, skip } from "./lines.mjs";
import { BINARY_PROBE_BYTES } from "./reader.mjs";
import { NOT_RETAINED } from "./store.mjs";
import { absolutePath, fileKey } from "./targets.mjs";

// shortest matching start or end worth reporting or pairing, shortest newText worth looking for, most places listed,
// characters quoted at a difference, most positions paired into a suggestion, allowed length difference of a
// suggested stretch (characters, or share of oldText if larger)
const HINT = { minMatchChars: 8, minNewTextChars: 12, maxLines: 10, quoteChars: 40, maxPairs: 20, slackChars: 8, slackShare: 0.1 };
const Q = HINT.quoteChars;

const count = (hay, needle) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) n++;
  return n;
};
const lineAt = (text, i) => text.slice(0, i).split("\n").length;
export const lf = (s) => String(s ?? "").replace(/\r\n/g, "\n");
const quote = (s, max = Q) => JSON.stringify(s.length > max ? `${s.slice(0, max)}…` : s);
const quoteEnd = (s, max = Q) => JSON.stringify(s.length > max ? `…${s.slice(-max)}` : s);
const textAfter = (s, k) => quote(s.slice(k, k + Q + 1));
const textBefore = (s, k) => quoteEnd(s.slice(Math.max(0, k - Q - 1), k));
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// one-to-one folding for the suggestion search (letter case, no-break spaces, curly quotes, dashes), so a position in
// the folded text is the same position in the original; case is kept when lowering would change a length
const LOOK_ALIKE = /[   ‘’‚‛“”„‐-―−]/g;
const plain = (c) => ("   ".includes(c) ? " " : "‘’‚‛".includes(c) ? "'" : "“”„".includes(c) ? '"' : "-");
function fold(...texts) {
  const lower = texts.every((s) => s.toLowerCase().length === s.length);
  return texts.map((s) => (lower ? s.toLowerCase() : s).replace(LOOK_ALIKE, plain));
}

// code points of two differing characters when either is not printable ASCII (no-break space, tab, curly quote)
function codePoints(fileChar, wantChar) {
  const cp = (c) => (c === undefined ? "no character" : `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")}`);
  const odd = (c) => c !== undefined && /[^\x20-\x7e]/.test(c);
  return odd(fileChar) || odd(wantChar) ? ` (file ${cp(fileChar)}, oldText ${cp(wantChar)})` : "";
}

// how a suggested file text differs from oldText
function difference(cand, want) {
  const [fc, fw] = fold(cand, want);
  const at = (k) => (k ? `after ${quoteEnd(cand.slice(Math.max(0, k - 16), k), 16)}, ` : "");
  let s = 0, e = 0;
  while (s < fc.length && s < fw.length && fc[s] === fw[s]) s++;
  if (s === fc.length && s === fw.length) {
    let k = 0;
    while (cand[k] === want[k]) k++;
    return `only letter case or look-alike characters differ, first ${at(k)}the file has ${textAfter(cand, k)} where oldText has ${textAfter(want, k)}${codePoints(cand[k], want[k])}`;
  }
  while (e < fc.length - s && e < fw.length - s && fc[fc.length - 1 - e] === fw[fw.length - 1 - e]) e++;
  const c = cand.slice(s, cand.length - e);
  const w = want.slice(s, want.length - e);
  const elsewhere = cand.slice(0, s) !== want.slice(0, s) || cand.slice(cand.length - e) !== want.slice(want.length - e);
  return `${at(s)}the file has ${quote(c)} where oldText has ${quote(w)}${codePoints(c[0], w[0])}${elsewhere ? "; letter case or look-alike characters differ as well" : ""}`;
}

// true when an occurrence of newText already spans [from, to): writing the edit again would repeat text
function covered(t, from, to, newText) {
  if (!newText) return false;
  for (let i = t.indexOf(newText); i !== -1 && i <= from; i = t.indexOf(newText, i + 1)) if (to <= i + newText.length) return true;
  return false;
}

const starts = (hay, needle) => {
  const out = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length <= HINT.maxPairs; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
};

// The one place oldText most likely meant when it differs only lightly: { cand, why }, { skip, why } or { hints }.
function suggest(t, oldText, newText) {
  const [ft, fo] = fold(t, oldText);
  const hints = [];
  const offer = (from, to, kind) => {
    const cand = t.slice(from, to);
    if (count(t, cand) !== 1) return null;
    if (covered(t, from, to, newText)) return { skip: true, why: `already applied: newText already covers the likely match at line ${lineAt(t, from)}` };
    return { cand, why: `found 0 times; SUGGESTED at line ${lineAt(t, from)}, ${kind}: ${difference(cand, oldText)}` };
  };
  const words = fo.trim().split(/\s+/).filter(Boolean);
  if (words.length) {
    const re = new RegExp(`${/^\s/.test(fo) ? "\\s+" : ""}${words.map(escapeRe).join("\\s+")}${/\s$/.test(fo) ? "\\s+" : ""}`, "g");
    const hits = [];
    for (let m; hits.length <= HINT.maxLines && (m = re.exec(ft)); ) hits.push(m);
    const one = hits.length === 1 && offer(hits[0].index, hits[0].index + hits[0][0].length, "differing only in whitespace, letter case or look-alike characters");
    if (one) return one;
    if (hits.length > 1) {
      const n = hits.length > HINT.maxLines ? `more than ${HINT.maxLines}` : hits.length;
      hints.push(`ignoring whitespace, letter case and look-alike characters it matches ${n} times (lines ${hits.slice(0, HINT.maxLines).map((m) => lineAt(t, m.index)).join(", ")})`);
    }
  }
  const longest = (fits) => {
    let lo = 0, hi = oldText.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (fits(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const head = longest((k) => ft.includes(fo.slice(0, k)));
  const tail = longest((k) => ft.includes(fo.slice(fo.length - k)));
  const headAt = starts(ft, fo.slice(0, head));
  const tailAt = starts(ft, fo.slice(fo.length - tail));
  if (!hints.length && head >= HINT.minMatchChars && tail >= HINT.minMatchChars && headAt.length <= HINT.maxPairs && tailAt.length <= HINT.maxPairs) {
    const slack = Math.max(HINT.slackChars, Math.ceil(oldText.length * HINT.slackShare));
    const pairs = [];
    for (const a of headAt) for (const b of tailAt) if (b >= a && b + tail >= a + head && Math.abs(b + tail - a - oldText.length) <= slack) pairs.push([a, b + tail]);
    const one = pairs.length === 1 && offer(...pairs[0], "differing only in a short stretch");
    if (one) return one;
  }
  const where = (part, at) => {
    const others = count(ft, part) - 1;
    return `line ${lineAt(t, at)}${others ? ` (and ${others} other place(s))` : ""}`;
  };
  if (head >= HINT.minMatchChars) {
    const a = headAt[0];
    hints.push(`its first ${head} of ${oldText.length} characters match at ${where(fo.slice(0, head), a)}; then the file has ${textAfter(t, a + head)} where oldText has ${textAfter(oldText, head)}${codePoints(t[a + head], oldText[head])}`);
  }
  if (tail >= HINT.minMatchChars) {
    const b = tailAt[0], k = oldText.length - tail;
    hints.push(`its last ${tail} characters match at ${where(fo.slice(k), b)}; before that the file has ${textBefore(t, b)} where oldText has ${textBefore(oldText, k)}${codePoints(t[b - 1], oldText[k - 1])}`);
  }
  if (!hints.length) hints.push(`neither its first nor its last ${HINT.minMatchChars} characters occur in the file`);
  return { hints };
}

// why oldText does not occur exactly once, with the cheapest fix: { why, cand }, { why, occurrences }, { why, skip }
// or { why } (a corrected oldText is needed)
function diagnose(env, p, oldText, newText, n) {
  const t = p.text;
  if (n > 1) {
    const at = [];
    for (let i = t.indexOf(oldText); i !== -1 && at.length < HINT.maxLines; i = t.indexOf(oldText, i + oldText.length)) at.push(`#${at.length + 1} line ${lineAt(t, i)}`);
    return { occurrences: n, why: `found ${n} times (${at.join(", ")}${n > at.length ? ", ..." : ""})` };
  }
  const sig = env.store.sign(p.abs, "text", oldText, newText);
  if ((env.store.wasWritten(sig) || p.sigs.includes(sig)) && t.includes(newText)) return { skip: true, why: "already applied: this session wrote this edit before" };
  if (count(p.base, oldText)) {
    return { why: `found 0 times; the file had it before this call (line ${lineAt(p.base, p.base.indexOf(oldText))}), but an earlier edit of this call changed it; give oldText that matches the edited text` };
  }
  const s = suggest(t, oldText, newText);
  if (s.cand || s.skip) return s;
  if (newText.length >= HINT.minNewTextChars && t.includes(newText)) s.hints.push(`newText already occurs at line ${lineAt(t, t.indexOf(newText))}: if an earlier call wrote this edit, leave it out`);
  return { why: `found 0 times; ${s.hints.join("; ")}` };
}

function apply(env, p, at, length, newText, id, ...sigs) {
  p.text = p.text.slice(0, at) + newText + p.text.slice(at + length);
  p.applied++;
  p.sigs.push(...sigs);
  if (id) env.run.used.push(id);
}

function fail(env, p, oldText, newText, label, d, id) {
  const { run, store } = env;
  if (d.skip) return skip(run, label, d.why, id);
  const fid = store.remember({ abs: p.abs, oldText, newText, cand: d.cand, occurrences: d.occurrences }, id);
  const form = d.cand ? `{"id":"${fid}"}` : d.occurrences ? `{"id":"${fid}","occurrence":<1-${d.occurrences}>}` : `{"id":"${fid}","oldText":"<corrected>"}`;
  run.failed.push(`${fid} ${label}: ${d.why} → ${store.hasFix(fid) ? `fix: ${form}` : NOT_RETAINED}`);
  run.failedEdits++;
  p.failed++;
}

// one oldText edit against the file state p: apply it, skip it (already in the file) or fail it with a diagnosis
function attempt(env, p, oldText, newText, label, id, ...sigs) {
  // CR-FIL-04: an empty oldText (also one retained by an earlier version) would never advance the count
  if (!oldText) return fail(env, p, "", newText, label, { why: "oldText is empty (for a line edit give from/to or after, with the tag on the file entry)" }, id);
  const n = count(p.text, oldText);
  if (n !== 1) return fail(env, p, oldText, newText, label, diagnose(env, p, oldText, newText, n), id);
  const at = p.text.indexOf(oldText);
  if (oldText !== newText && covered(p.text, at, at + oldText.length, newText)) {
    return skip(env.run, label, `already applied: newText already covers the only match (line ${lineAt(p.text, at)})`, id);
  }
  apply(env, p, at, oldText.length, newText, id, env.store.sign(p.abs, "text", oldText, newText), ...sigs);
}

function hasMixedEndings(raw) {
  const crlf = raw.split("\r\n").length - 1;
  return crlf > 0 && crlf !== raw.split("\n").length - 1;
}

// The file state of abs for this call (a file listed again, under any spelling, continues from the earlier entries'
// text), or a reason.
function load(env, abs) {
  try {
    env.guard(abs);
    const key = fileKey(abs);
    const known = env.byFile.get(key);
    if (known) return { p: known };
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) return { reason: "is a folder, not a file" };
    const raw = fs.readFileSync(abs);
    if (raw.subarray(0, BINARY_PROBE_BYTES).includes(0)) return { reason: `a binary file (${raw.length} bytes), not text; edit it with a script or a tool made for it` };
    const text = raw.toString("utf8");
    if (hasMixedEndings(text)) return { reason: "mixed line endings; use native Edit" };
    const crlf = text.includes("\r\n");
    const base = crlf ? lf(text) : text;
    const p = { abs, crlf, base, text: base, applied: 0, failed: 0, sigs: [] };
    env.byFile.set(key, p);
    return { p };
  } catch (e) {
    return { reason: e.code === "ENOENT" ? "file not found" : e.message };
  }
}

function retryFix(env, fx) {
  const { run, store } = env;
  const id = String(fx.id);
  // CR-FIL-03: a fix runs at most once per call; its ID is consumed only when the call commits
  if (env.reserved.has(id)) return skip(run, id, "this fix ID is listed again in this call; it was handled once");
  env.reserved.add(id);
  const e = store.fix(id);
  if (!e) {
    run.failed.push(`${id}: unknown fix id (or expired); IDs are session-bound, used once, and retained up to 500 failures or 8 MiB (oldest evicted); resend the edit`);
    run.failedEdits++;
    return;
  }
  if (e.edits) return env.queue.push({ path: fx.path ?? e.path ?? "", tag: fx.tag ?? e.tag, edits: e.edits, fixId: id });
  const { p } = load(env, fx.path !== undefined ? absolutePath(fx.path, env.cwd) : e.abs);
  const label = `${e.abs} retry ${e.line ? lineLabel(e.line) : quote(e.oldText, 60)}`;
  if (!p) {
    run.failed.push(`${id} ${label}: file not found any more`);
    run.failedEdits++;
    return;
  }
  if (e.line) return lineFix(env, p, id, e, fx);
  const newText = fx.newText !== undefined ? lf(fx.newText) : e.newText;
  const firstSig = store.sign(p.abs, "text", e.oldText, e.newText); // a later resend of the edit as first sent is a skip
  if (fx.oldText !== undefined) return attempt(env, p, lf(fx.oldText), newText, label, id, firstSig);
  if (fx.occurrence !== undefined && e.occurrences && e.oldText) {
    const at = [];
    for (let i = p.text.indexOf(e.oldText); i !== -1; i = p.text.indexOf(e.oldText, i + e.oldText.length)) at.push(i);
    if (at.length === e.occurrences && fx.occurrence <= at.length) return apply(env, p, at[fx.occurrence - 1], e.oldText.length, newText, id, firstSig);
  } else if (fx.occurrence === undefined && e.cand && count(p.text, e.cand) === 1) {
    const at = p.text.indexOf(e.cand);
    if (covered(p.text, at, at + e.cand.length, newText)) return skip(run, label, `already applied at line ${lineAt(p.text, at)}`, id);
    return apply(env, p, at, e.cand.length, newText, id, firstSig);
  }
  attempt(env, p, e.oldText, newText, label, id, firstSig); // the file changed, or the fix does not fit: diagnose afresh
}

function editEntry(env, f) {
  const { run, store } = env;
  const edits = f.edits.map((e) => ({ oldText: e.oldText === undefined ? undefined : lf(e.oldText), newText: lf(e.newText), from: e.from, to: e.to, after: e.after }));
  let abs, reason;
  try {
    abs = absolutePath(f.path, env.cwd);
  } catch (e) {
    reason = e.message;
  }
  const loaded = abs ? load(env, abs) : { reason };
  if (!loaded.p) {
    // mutation targets are never guessed (FTOL-20): the guess only fills the fix form
    const g = loaded.reason === "file not found" ? guessPath(abs, env.cwd) : { candidates: [] };
    const fid = store.remember({ edits, path: f.path, tag: f.tag }, f.fixId);
    const seen = g.candidates.length ? `; did you mean: ${g.candidates.join(" | ")}` : "";
    const form = store.hasFix(fid) ? `fix: {"id":"${fid}","path":${JSON.stringify(g.unique ?? "<corrected>")}}` : NOT_RETAINED;
    run.failed.push(`${fid} ${f.path || "(no path)"}: ${loaded.reason}${seen} (${edits.length} edit(s) not written) → ${form}`);
    run.failedEdits += edits.length;
    return;
  }
  const p = loaded.p;
  if (f.fixId) run.used.push(f.fixId);
  const label = (e, i) => `${f.path} edit ${i + 1} ${isLineEdit(e) ? lineLabel(e) : quote(e.oldText ?? "", 60)}`;
  const byLine = edits.map((e, i) => [e, i]).filter(([e]) => isLineEdit(e));
  if (byLine.length) lineEdits(env, p, byLine.map(([e]) => ({ ...e, tag: f.tag })), byLine.map(([e, i]) => label(e, i)));
  edits.forEach((e, i) => {
    if (isLineEdit(e)) return;
    if (!e.oldText) return fail(env, p, "", e.newText, label(e, i), { why: "oldText is empty (for a line edit give from/to or after, with the tag on the file entry)" });
    attempt(env, p, e.oldText, e.newText, label(e, i));
  });
}

const RETRY = "Fix a failed edit in a later call by its id in fixes, in the form at the end of its line (the server kept the edit), or leave it out; never resend written edits.";

// ctx: { cwd, guard(abs), store, io? }. Returns the reply text, or { isError, text }.
export function editMultiple({ files = [], fixes = [], dryRun = false, atomic = false }, ctx) {
  if (!files.length && !fixes.length) return { isError: true, text: "nothing written: give files, fixes or both" };
  const run = { failed: [], skipped: [], moved: [], failedEdits: 0, used: [] };
  const env = { ...ctx, run, byFile: new Map(), queue: [], reserved: new Set() };
  for (const fx of fixes) retryFix(env, fx); // fixes of earlier failures first: they finish the earlier call
  for (const f of [...files, ...env.queue]) editEntry(env, f); // then the {id, path} file fixes queued above
  const states = [...env.byFile.values()].filter((p) => p.applied);
  const applied = states.reduce((s, p) => s + p.applied, 0);
  const plan = states.map((p) => {
    const delta = p.text.length - p.base.length;
    return { abs: p.abs, text: p.crlf ? p.text.replace(/\n/g, "\r\n") : p.text, summary: `${p.abs}: ${p.applied} edit(s)${p.failed ? ` (${p.failed} failed)` : ""}, ${delta >= 0 ? "+" : ""}${delta} chars` };
  });
  // IDs survive dryRun and aborted calls (FTOL-31); signatures only after a real commit (FTOL-32)
  const consume = () => run.used.forEach((id) => ctx.store.consume(id));
  const report = [
    run.moved.length && `line edits whose lines had moved since their read:\n${run.moved.join("\n")}`,
    run.skipped.length && `skipped, already in the file:\n${run.skipped.join("\n")}`,
    run.failedEdits && `failed:\n${run.failed.join("\n")}`,
  ].filter(Boolean);
  if (run.failedEdits && (atomic || !plan.length)) {
    if (!plan.length && !dryRun && !atomic) consume(); // CR-FIL-05: an atomic abort keeps every ID
    return { isError: true, text: [`nothing written${atomic && plan.length ? " (atomic: true)" : ""}: ${run.failedEdits} edit(s) failed. ${RETRY}`, ...report].join("\n") };
  }
  if (!dryRun) {
    try {
      commitFiles(plan, ctx.io, ctx.journal);
    } catch (e) {
      return { isError: true, text: [e.message, ...report].join("\n") };
    }
    ctx.store.recordWritten(states.flatMap((p) => p.sigs));
    consume();
  }
  const done = plan.map((p) => `${dryRun ? "would edit" : "edited"} ${p.summary}`);
  if (!run.failedEdits) return [...done, ...report].join("\n") || "nothing to change";
  const head = dryRun
    ? `DRY RUN, nothing written: ${applied} edit(s) would be written, ${run.failedEdits} would fail`
    : `PARTLY WRITTEN: ${applied} edit(s) written, ${run.failedEdits} failed and not written`;
  return { isError: true, text: [`${head}. ${RETRY}`, ...done, ...report].join("\n") };
}

export function writeMultiple({ files }, ctx) {
  const plan = [];
  const errors = [];
  const seen = new Set();
  for (const f of files) {
    try {
      const abs = absolutePath(f.path, ctx.cwd);
      ctx.guard(abs);
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) throw new Error(`${f.path}: is a folder, not a file`);
      const key = fileKey(abs);
      if (seen.has(key)) {
        errors.push(`${f.path}: listed twice`);
        continue;
      }
      seen.add(key);
      plan.push({ abs, text: f.content });
    } catch (e) {
      errors.push(e.message.startsWith(f.path) ? e.message : `${f.path}: ${e.message}`);
    }
  }
  if (errors.length) return { isError: true, text: `nothing written:\n${errors.join("\n")}` };
  try {
    commitFiles(plan, ctx.io, ctx.journal);
  } catch (e) {
    return { isError: true, text: e.message };
  }
  return plan.map((p) => `wrote ${p.abs} (${p.text.length} chars)`).join("\n");
}
