// The outline manifest (GSDC-24): one entry per outline row, {id, owns, requirements, produces, consumes, tracer, verify}.
// `produces` and `consumes` are the cross-plan edges the outline check orders by wave; nothing quotes or verifies signatures
// (the kit's contract gate is gone: upstream GSD has none). Manifests written while it existed keep their structured entries.
import { asArray, escapeRe, readIf } from "./common.mjs";
import { phaseFile } from "./planning.mjs";

const WORD = "[A-Za-z0-9_$]";
const wordIn = (text, name) => Boolean(name) && new RegExp(`(^|[^A-Za-z0-9_$])${escapeRe(name)}(?!${WORD})`).test(String(text ?? ""));
const str = (v) => (typeof v === "string" ? v.trim() : "");

// One element of a manifest entry's `produces`. Structured = symbol, kind, file and signature given; anything else is legacy
// free text (a string, or an object with only a symbol) that is never checked beyond a word match. `problems` lists a
// half-structured object (some of kind/file/signature missing).
export function producedOf(entry) {
  if (typeof entry === "string") return { symbol: entry.trim(), kind: null, file: null, signature: null, supersedes: [], structured: false, text: entry, problems: [] };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return { symbol: "", kind: null, file: null, signature: null, supersedes: [], structured: false, text: "", problems: ["is not a string or an object"] };
  const e = { symbol: str(entry.symbol), kind: str(entry.kind), file: str(entry.file).replace(/\\/g, "/").replace(/^\.\//, ""), signature: str(entry.signature), supersedes: asArray(entry.supersedes).map(String) };
  // An object with a file or a signature must give all of kind, file and signature; a symbol
  // (with a kind or other keys) alone is the earlier free-form entry.
  const problems = [];
  if (!e.symbol) problems.push("has no symbol");
  if ((e.file || e.signature) && !(e.kind && e.file && e.signature)) problems.push(`is missing ${["kind", "file", "signature"].filter((k) => !e[k]).join(", ")}`);
  return { ...e, structured: Boolean(e.symbol) && Boolean(e.kind && e.file && e.signature), text: JSON.stringify(entry), problems };
}
export const producesOf = (planEntry) => asArray(planEntry?.produces).map(producedOf);

// The produced entry a consumes edge names: the same symbol, a member of a structured symbol (`Client` for `Client.pause`), or a
// legacy free-text entry that holds the symbol as a word.
export function resolveEdge(produced, symbol) {
  const sym = String(symbol ?? "").trim();
  return produced.find((p) => p.structured && p.symbol === sym)
    ?? produced.find((p) => p.structured && sym.startsWith(p.symbol) && /^[.:#]/.test(sym.slice(p.symbol.length)))
    ?? produced.find((p) => !p.structured && (p.symbol === sym || wordIn(p.text, sym)))
    ?? null;
}

export function readManifest(phase) {
  const file = phaseFile(phase, "PLAN-OUTLINE.manifest.json");
  const text = readIf(file);
  if (text === null) return { file, manifest: null, error: "manifest missing" };
  try {
    const manifest = JSON.parse(text);
    if (!manifest || !Array.isArray(manifest.plans)) return { file, manifest: null, error: "manifest has no plans array" };
    return { file, manifest, error: null };
  } catch (e) {
    return { file, manifest: null, error: `manifest is not valid JSON (${e.message})` };
  }
}
const entriesOf = (manifest) => (manifest?.plans ?? []).filter((p) => p && typeof p === "object" && typeof p.id === "string");

// The manifest text the freeze key hashes. The former contract gate wrote `produces[*].signature`, `supersedes`, `contract_changes`
// and `added` symbols; they and an owns verb's edits (`owns_outline`, the owns the skeleton reviewed) stay out of it too, so neither
// stales the reviewed skeleton (kit feedback W15, W16). A manifest with no structured signature and none of that meta hashes as
// written (unchanged for every earlier project).
export function manifestFreezeText(text) {
  if (text === null || text === undefined) return text ?? null;
  let m;
  try { m = JSON.parse(text); } catch { return text; }
  const meta = entriesOf(m).some((p) => p.owns_outline || p.owns_extra || p.owns_held || asArray(p.produces).some((e) => e && typeof e === "object" && e.added));
  const structured = entriesOf(m).some((p) => asArray(p.produces).some((e) => e && typeof e === "object" && typeof e.signature === "string" && !e.added));
  if (!structured && !meta) return text;
  const { contract_changes: _drop, owns_changes: _ownsLog, ...rest } = m;
  return JSON.stringify({ ...rest, plans: asArray(m.plans).map(freezePlan) });
}
// One manifest plan as the freeze key hashes it: signatures, superseded text, added symbols and the owns-verb bookkeeping out.
// A plan's revision key holds its own entry in this form (revisions.mjs).
export const manifestEntryFreeze = (p) => freezePlan(p);
function freezePlan(p) {
  if (!p || typeof p !== "object") return p;
  const outline = Array.isArray(p.owns_outline) ? p.owns_outline : null;
  if (!Array.isArray(p.produces) && !outline && !p.owns_extra && !p.owns_held) return p;
  const { owns_outline: _a, owns_extra: _b, owns_held: _c, ...base } = p;
  if (outline) base.owns = outline;
  if (!Array.isArray(p.produces)) return base;
  const produces = [];
  for (const e of p.produces) {
    if (!e || typeof e !== "object") { produces.push(e); continue; }
    if (e.added) continue;
    const { signature: _s, supersedes: _u, ...keep } = e;
    produces.push(keep);
  }
  return { ...base, produces };
}
