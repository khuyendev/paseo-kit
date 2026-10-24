// `ph gsd owns add` and `ph gsd owns handover` (kit feedback W16): an owns-only answer to a planner SOURCE AUDIT.
// The manifest's owns change; `owns_outline` keeps the owns the skeleton reviewed, so the freeze hash does not move
// (manifestFreezeText) and only the plans whose owns changed are planned again. The answer is logged in owner-answers.json.
import { writeJsonAtomic } from "../lib/io.mjs";
import { covers, hasGlob, ownsPath, overlaps, pathKey, repoPath } from "./adapter-hooks.mjs";
import { asArray, done, fail, rel, withFileLock } from "./common.mjs";
import { readManifest } from "./contracts.mjs";
import { readOutline } from "./outline.mjs";
import { answersFile, appendAnswer } from "./owner-answers.mjs";
import { normPlanId } from "./planning.mjs";
import { acceptManifestEdit } from "./revisions.mjs";
import { guardWriter } from "./state.mjs";

const entriesOf = (manifest) => (manifest?.plans ?? []).filter((p) => p && typeof p === "object" && typeof p.id === "string");
const sameId = (a, b) => normPlanId(String(a)) === normPlanId(String(b));
const reasonOf = (reason) => {
  const text = String(reason ?? "").trim();
  if (!text) throw fail("owns needs --reason <why the owns change>");
  return text;
};
// An owns entry as stored, and the path `ownsPath` compares. A bare repo path takes the `Path:` form.
function parsePath(forms, raw) {
  const s = String(raw ?? "").trim().replace(/\\/g, "/");
  if (!s) throw fail("owns needs --path <a repo path or an owns entry>");
  const direct = ownsPath(s, forms);
  if (direct) return { entry: s, mapped: direct };
  const form = forms.find((f) => f.maps_to === "<path>") ?? { prefix: "Path:" };
  const mapped = hasGlob(s) ? s.replace(/^\.\//, "") : repoPath(s);
  if (!mapped) throw fail(`owns path is not inside the code root: ${s}`);
  return { entry: `${form.prefix}${mapped}`, mapped };
}
const mappedOf = (entry, forms) => ownsPath(String(entry), forms);
const sameMapped = (a, b) => a === b || (pathKey(a) !== null && pathKey(a) === pathKey(b));
const exactEntry = (owns, forms, mapped) => asArray(owns).find((o) => { const m = mappedOf(o, forms); return m && sameMapped(m, mapped); });
const coveredBy = (owns, forms, mapped) => asArray(owns).some((o) => { const m = mappedOf(o, forms); return m && covers(m, mapped); });
function othersOwning(entries, forms, mapped, exceptId) {
  return entries.filter((e) => !sameId(e.id, exceptId) && asArray(e.owns).some((o) => { const m = mappedOf(o, forms); return m && overlaps(m, mapped); })).map((e) => String(e.id));
}
function findEntry(entries, id, verb) {
  const entry = entries.find((p) => sameId(p.id, id));
  if (!entry) throw fail(`${verb} rejected: manifest has no entry for ${id}`);
  return entry;
}
// The owns the skeleton reviewed, kept once, so later verb edits stay out of the freeze hash.
function rememberOutline(entry) {
  if (!Array.isArray(entry.owns_outline)) entry.owns_outline = [...asArray(entry.owns)];
}
const asPaths = (paths) => {
  const list = (Array.isArray(paths) ? paths : paths ? [paths] : []).map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!list.length) throw fail("owns needs --path <p> (repeat --path for more than one)");
  return list;
};
const waveOf = (phase) => {
  const rows = readOutline(phase).rows ?? [];
  return (id) => rows.find((r) => sameId(r.id, id))?.wave ?? null;
};

export function ownsAdd(g, phase, { plan, paths, reason }) {
  guardWriter(g.env);
  const why = reasonOf(reason);
  const id = String(plan ?? "").trim();
  if (!id) throw fail("owns add needs --plan <NN-MM>");
  return edit(g, phase, "add", (fresh) => {
    const forms = g.cfg.adapter.ownership.owns_forms;
    const entry = findEntry(entriesOf(fresh), id, "owns add");
    const want = asPaths(paths).map((p) => parsePath(forms, p));
    const added = [];
    for (const item of want) {
      const others = othersOwning(entriesOf(fresh), forms, item.mapped, entry.id);
      if (others.length) throw fail(`owns add rejected: ${item.mapped} is owned by ${others.join(", ")}; hand it over with ph gsd owns handover <phase> --from <id> --to ${entry.id} --path ${item.mapped} --reason <text>`);
      if (coveredBy(entry.owns, forms, item.mapped)) continue;
      added.push(item.entry);
    }
    if (!added.length) return { already: true, plan: entry.id, paths: want.map((i) => i.entry) };
    rememberOutline(entry);
    entry.owns = [...asArray(entry.owns), ...added];
    const answer = appendAnswer(phase, { kind: "owns", op: "add", plan: entry.id, paths: added, reason: why });
    return { plan: entry.id, paths: added, answer, invalidate: [entry.id] };
  });
}

export function ownsHandover(g, phase, { from, to, paths, reason }) {
  guardWriter(g.env);
  const why = reasonOf(reason);
  const src = String(from ?? "").trim();
  const dst = String(to ?? "").trim();
  if (!src || !dst) throw fail("owns handover needs --from <NN-MM> and --to <NN-MM>");
  if (sameId(src, dst)) throw fail("owns handover rejected: --from and --to are the same plan");
  return edit(g, phase, "handover", (fresh) => {
    const forms = g.cfg.adapter.ownership.owns_forms;
    const source = findEntry(entriesOf(fresh), src, "owns handover");
    const target = findEntry(entriesOf(fresh), dst, "owns handover");
    const waves = waveOf(phase);
    const [sw, tw] = [waves(source.id), waves(target.id)];
    if (!Number.isInteger(sw) || !Number.isInteger(tw)) throw fail(`owns handover rejected: ${!Number.isInteger(sw) ? source.id : target.id} has no wave in the outline`);
    if (sw === tw) throw fail(`owns handover rejected: ${source.id} and ${target.id} are both wave ${sw}; a same-wave move is an outline change (ph gsd decide --outline)`);
    const want = asPaths(paths).map((p) => parsePath(forms, p));
    const strip = [];
    const give = [];
    for (const item of want) {
      const hit = exactEntry(source.owns, forms, item.mapped);
      const onTarget = exactEntry(target.owns, forms, item.mapped);
      // A replay of a hand-over that already landed (the target has it, the source does not) is a no-op.
      if (!hit && onTarget) continue;
      if (!hit) {
        const via = asArray(source.owns).find((o) => { const m = mappedOf(o, forms); return m && covers(m, item.mapped); });
        throw fail(via ? `owns handover rejected: ${source.id} owns ${item.mapped} only through ${via}; hand that entry over, or change the outline (ph gsd decide --outline)` : `owns handover rejected: ${source.id} does not own ${item.mapped}`);
      }
      const others = othersOwning(entriesOf(fresh), forms, item.mapped, source.id).filter((pid) => !sameId(pid, target.id));
      if (others.length) throw fail(`owns handover rejected: ${item.mapped} is also owned by ${others.join(", ")}`);
      strip.push(hit);
      if (!onTarget) give.push(hit);
    }
    if (!strip.length) return { already: true, from: source.id, to: target.id, paths: want.map((i) => i.entry) };
    rememberOutline(source);
    rememberOutline(target);
    const gone = new Set(strip);
    source.owns = asArray(source.owns).filter((o) => !gone.has(o));
    target.owns = [...asArray(target.owns), ...give];
    const answer = appendAnswer(phase, { kind: "owns", op: "handover", from: source.id, to: target.id, paths: [...strip], reason: why });
    return { from: source.id, to: target.id, paths: [...strip], answer, invalidate: [source.id, target.id] };
  });
}

function edit(g, phase, op, mutate) {
  const { file, error } = readManifest(phase);
  if (error) throw fail(`owns ${op} rejected: ${error}`);
  const made = withFileLock(`${file}.lock`, () => {
    const fresh = readManifest(phase).manifest;
    const out = mutate(fresh);
    if (!out.already) writeJsonAtomic(file, fresh);
    return out;
  });
  if (made.already) return done({ changed: false, already: true, op, plan: made.plan ?? null, from: made.from ?? null, to: made.to ?? null, paths: made.paths });
  const invalidated = acceptManifestEdit(g, phase, made.invalidate);
  return done({
    changed: true, op, plan: made.plan ?? null, from: made.from ?? null, to: made.to ?? null, paths: made.paths,
    answered: made.answer.id, kind: "owns", invalidated, answers: rel(g.codeRoot, answersFile(phase)), manifest: rel(g.codeRoot, file),
    next: "rerun gsd-plan with the same args; only the plans whose owns changed are planned again",
  });
}
