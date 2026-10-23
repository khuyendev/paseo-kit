// Execute state (kit feedback 83 F1/F2, 86, 87): the one writer of <phaseDir>/execute-progress.json, the record a resumed
// gsd-execute starts from. Each state-* verb is one completion contract: it checks its input against the record and the tree
// (refused, nothing written, when the contract does not hold), writes the record under its lock and answers with the whole
// state after the update, so a composition decides from what is on disk, never from its own memory. `rev` grows with every
// write; a caller keeping a copy takes only a newer one. A record of an older kit is migrated when read and stored on the next
// write. Readers outside the flow (ph gsd shared clear, request clear) use readStateFile.
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../harness/config.mjs";
import { matchesGlob } from "../../harness/adapter/contract.mjs";
import { withFileLock } from "../../harness/gsd/common.mjs";
import { textDigest } from "../../harness/lib/hash.mjs";
import { readJsonIf, readText, writeJsonAtomic } from "../../harness/lib/io.mjs";
import { OWNER_ANSWERS_FILE, readAnswers, waveMatches } from "../../harness/lib/owner-answers.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";
import { git } from "./flow-git.mjs";

export const STATE_FILE = "execute-progress.json";
export const STATE_VERSION = 2;
export const PLAN_STAGES = Object.freeze(["dispatched", "executed", "transferred", "committed", "tracked", "halted"]);
// How a cross-plan request closes: tree (its path changed since the request), shared change (an applied or cleared shared
// change names its path), resolver (the read-only resolver found it present), owner (ph gsd request clear, taken with
// state-answer), reply (the owner plan named it in resolvedRequests).
export const CLOSE_BY = Object.freeze(["tree", "shared change", "resolver", "owner", "reply"]);
const BY_ALIAS = { "changed-since-request": "tree", "shared-change": "shared change" };
const PLAN_ID = /^\d+(\.\d+)?-\d+$/;
// Optional containers left out of the file while empty (gsd.request_check off records no requestBase).
const OPTIONAL = ["requestBase", "stages", "closed", "answered", "integrationBy"];

const slash = (p) => String(p ?? "").trim().replace(/\\/g, "/").replace(/^\.\//, "");
const isKitDoc = (p) => /(^|\/)kit-feedback\.md$/i.test(slash(p));
export const requestKey = (plan, q) => JSON.stringify([plan, q.from ?? null, slash(q.path), q.change ?? null]);
export const isStateFile = (rel) => path.basename(slash(rel)) === STATE_FILE;
const stateFile = (root, phaseDir) => path.join(resolveInside(root, phaseDir), STATE_FILE);

class Refused extends Error {}
const refuse = (why) => { throw new Refused(why); };
// A refused route says that its target is generated, so the composition can hold it for the owner.
const refuseGenerated = (why) => { throw Object.assign(new Refused(why), { generated: true }); };
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

function fresh() {
  return { version: STATE_VERSION, rev: 0, plans: {}, stages: {}, requests: {}, requestBase: {}, shared: [], integration: [], integrationBy: {}, closed: [], answered: [] };
}

// Schema check of a stored record; `file` names it in the error.
function check(data, file) {
  const bad = (what) => { throw new Error(`${file}: ${what}; it is written only by the state-* flow verbs`); };
  if (!isObj(data)) bad("not a JSON object");
  const mapOf = (key, test, what) => {
    if (data[key] === undefined) return;
    if (!isObj(data[key])) bad(`${key} is not an object`);
    for (const [k, v] of Object.entries(data[key])) if (!test(v)) bad(`${key}.${k} ${what}`);
  };
  const listOf = (key, test, what) => {
    if (data[key] === undefined) return;
    if (!Array.isArray(data[key])) bad(`${key} is not a list`);
    data[key].forEach((v, i) => { if (!test(v)) bad(`${key}[${i}] ${what}`); });
  };
  mapOf("plans", (p) => isObj(p) && (p.commit === undefined || typeof p.commit === "string") && (p.tracked === undefined || typeof p.tracked === "boolean"), "is not {commit, verify, evidence, tracked}");
  mapOf("stages", (s) => isObj(s) && PLAN_STAGES.includes(s.stage), `has no stage of ${PLAN_STAGES.join("|")}`);
  mapOf("requests", (l) => Array.isArray(l) && l.every((q) => isObj(q) && typeof q.path === "string"), "is not a list of requests with a path");
  mapOf("requestBase", (h) => h === null || typeof h === "string", "is not a digest or null");
  mapOf("integrationBy", (w) => typeof w === "string", "is not a reason");
  listOf("shared", (s) => isObj(s) && (s.path === null || s.path === undefined || typeof s.path === "string"), "is not a shared change");
  listOf("integration", (f) => typeof f === "string", "is not a path");
  listOf("closed", isObj, "is not a closure");
  listOf("answered", (x) => typeof x === "string", "is not an answer id");
  if (data.smoke !== undefined && data.smoke !== null && !isObj(data.smoke)) bad("smoke is not an object");
  if (data.version !== undefined && !(Number.isInteger(data.version) && data.version <= STATE_VERSION)) bad(`version ${data.version} is newer than this kit (${STATE_VERSION})`);
}

// A stored record as the typed state. A 3c00968 record (no version) gets ids for its shared changes and the empty containers.
function normalize(data) {
  const st = { ...fresh(), ...data };
  for (const k of ["plans", "stages", "requests", "requestBase", "integrationBy"]) st[k] = { ...(data[k] ?? {}) };
  for (const k of ["integration", "closed", "answered"]) st[k] = [...(data[k] ?? [])];
  let n = (data.shared ?? []).reduce((m, s) => Math.max(m, Number(/^S(\d+)$/.exec(s.id ?? "")?.[1] ?? 0)), 0);
  st.shared = (data.shared ?? []).map((s) => ({ ...s, id: s.id ?? `S${++n}`, applied: s.applied === true }));
  st.rev = Number.isInteger(data.rev) ? data.rev : 0;
  st.version = STATE_VERSION;
  return st;
}

function compact(st) {
  const out = { ...st };
  for (const k of OPTIONAL) if (Array.isArray(out[k]) ? !out[k].length : !Object.keys(out[k] ?? {}).length) delete out[k];
  return out;
}

/** The typed state of one execute-progress.json (a fresh state when there is none); never writes. */
export function readStateFile(file) {
  const data = readJsonIf(file, null);
  if (data === null) return { state: fresh(), exists: false, migrated: false };
  check(data, file);
  return { state: normalize(data), exists: true, migrated: data.version !== STATE_VERSION };
}

export const readState = (root, phaseDir) => readStateFile(stateFile(root, phaseDir)).state;

// One locked read-modify-write; a refusal writes nothing and answers with the state as it is.
function update(root, phaseDir, fn) {
  const file = stateFile(root, phaseDir);
  return withFileLock(`${file}.lock`, () => {
    const st = readStateFile(file).state;
    let out;
    try { out = fn(st) ?? {}; } catch (e) {
      if (e instanceof Refused) return { status: "refused", reason: e.message, ...(e.generated ? { generated: true } : {}), state: readStateFile(file).state, code: 1 };
      throw e;
    }
    st.rev += 1;
    writeJsonAtomic(file, compact(st));
    return { status: "ok", ...out, state: st };
  });
}

// adapter.ownership.regenerated: the generated files of the project (item 86); an unreadable config marks nothing generated.
function generatedTest(root) {
  let globs = [];
  try { globs = loadConfig(root).adapter.ownership.regenerated ?? []; } catch { globs = []; }
  return (p) => globs.some((g) => matchesGlob(p, g));
}
const relPath = (p, what) => {
  const s = slash(p);
  if (!s || path.isAbsolute(s) || /^[a-z]:/i.test(s) || s.split("/").includes("..")) refuse(`${what} ${JSON.stringify(p)} is not a path inside the project`);
  return s;
};
// via and outputs of a change: a generated target needs both, and outputs holds the target (item 86).
function generator(root, target, { via, outputs }) {
  const v = typeof via === "string" && via.trim() ? via.trim() : null;
  if (outputs !== undefined && !Array.isArray(outputs)) refuse("outputs is not a list of paths");
  const outs = [...new Set((outputs ?? []).map((o) => relPath(o, "an outputs entry")))];
  const extra = { ...(v ? { via: v } : {}), ...(outs.length ? { outputs: outs } : {}) };
  if (!target || !generatedTest(root)(target)) return { extra, missing: null };
  if (!v || !outs.includes(target)) return { extra, missing: `${target} is a generated file (adapter.ownership.regenerated): a change to it names via (the generator command) and every file the generator rewrites in outputs, ${target} included` };
  return { extra, missing: null };
}
const digestOf = (root, p) => {
  const abs = resolveInside(root, p);
  return fs.existsSync(abs) ? textDigest(readText(abs)) : null;
};
const addIntegration = (st, files, why) => {
  const added = [];
  for (const f of files) {
    if (!st.integration.includes(f)) { st.integration.push(f); added.push(f); }
    st.integrationBy[f] ??= why;
  }
  return added;
};
function closeOne(st, plan, q, by, why) {
  st.requests[plan] = (st.requests[plan] ?? []).filter((x) => x !== q);
  delete st.requestBase[requestKey(plan, q)];
  const row = { plan, from: q.from ?? null, path: slash(q.path), by, why: String(why ?? "").slice(0, 300) };
  st.closed.push(row);
  return row;
}
// Requests whose target path (or a generator output) a shared change changed close with it (kit feedback 85 F3).
function closeLinked(st, changes, how) {
  const byPath = new Map();
  for (const s of changes) for (const p of [s.path, ...(s.outputs ?? [])].filter(Boolean)) byPath.set(slash(p), s);
  const rows = [];
  for (const [plan, list] of Object.entries(st.requests)) for (const q of [...list]) {
    const s = byPath.get(slash(q.path));
    if (s) rows.push(closeOne(st, plan, q, "shared change", `the shared change to ${slash(s.path)} (${s.from ?? "declared"}) ${how}`));
  }
  return rows;
}

// ---- verbs ----

export function stateRead(root, phaseDir) {
  const r = readStateFile(stateFile(root, phaseDir));
  return { status: "ok", exists: r.exists, migrated: r.migrated, state: r.state };
}

// {plan, stage, summary?, worktree?, commit?, verify?, evidence?, reason?}
export function statePlan(root, phaseDir, input) {
  return update(root, phaseDir, (st) => {
    const { plan, stage } = input ?? {};
    if (!PLAN_ID.test(String(plan ?? ""))) refuse(`plan ${JSON.stringify(plan)} is not a plan id NN-MM`);
    if (!PLAN_STAGES.includes(stage)) refuse(`stage ${JSON.stringify(stage)} is not one of ${PLAN_STAGES.join("|")}`);
    const rec = { stage };
    if (stage === "executed") {
      const summary = relPath(input.summary, "summary");
      const wt = input.worktree ? relPath(input.worktree, "worktree") : null;
      const at = wt ? `${wt}/${summary}` : summary;
      if (!fs.existsSync(resolveInside(root, at))) refuse(`plan ${plan} is not executed: no SUMMARY at ${at}`);
      Object.assign(rec, { summary, ...(wt ? { worktree: wt } : {}) });
    } else if (stage === "transferred") {
      const tr = `${slash(phaseDir)}/transfers/${plan}.json`;
      if (!fs.existsSync(resolveInside(root, tr))) refuse(`plan ${plan} is not transferred: no ${tr}`);
    } else if (stage === "committed") {
      const sha = String(input.commit ?? "");
      if (!/^[0-9a-f]{7,40}$/.test(sha) || git(root, ["cat-file", "-e", `${sha}^{commit}`], { allowFail: true }).code !== 0) refuse(`commit ${JSON.stringify(input.commit)} of plan ${plan} is not a commit of this repository`);
      if (!["green", "skipped"].includes(input.verify)) refuse(`verify ${JSON.stringify(input.verify)} is not green|skipped`);
      const had = st.plans[plan]?.commit;
      if (had !== undefined && had !== sha) refuse(`plan ${plan} is committed already as ${had}`);
      if (had === undefined) st.plans[plan] = { commit: sha, verify: input.verify, evidence: input.evidence ?? null };
      rec.commit = sha;
    } else if (stage === "tracked") {
      if (st.plans[plan]?.commit === undefined) refuse(`plan ${plan} has no recorded commit to track`);
      st.plans[plan] = { ...st.plans[plan], tracked: true };
    } else if (stage === "halted") {
      if (!String(input.reason ?? "").trim()) refuse(`a halt of ${plan} needs its reason`);
      rec.reason = String(input.reason).slice(0, 300);
    }
    st.stages[plan] = rec;
    return { plan, stage };
  });
}

// {op: add, changes: [{from, path|null, change, reason?, key?, wave?, via?, outputs?}]} | {op: tag, wave} | {op: applied, ids, link?}
export function stateShared(root, phaseDir, input) {
  const op = input?.op;
  if (op === "cleared") return { status: "refused", reason: "a shared change is cleared only by the owner's answer (ph gsd shared clear), taken with state-answer", code: 1, state: readState(root, phaseDir) };
  return update(root, phaseDir, (st) => {
    if (op === "add") {
      const added = [];
      const refused = [];
      let n = st.shared.reduce((m, s) => Math.max(m, Number(/^S(\d+)$/.exec(s.id)?.[1] ?? 0)), 0);
      for (const c of input.changes ?? []) {
        const p = c.path === null || c.path === undefined || !String(c.path).trim() ? null : relPath(c.path, "path");
        if (!String(c.change ?? "").trim()) refuse(`the shared change to ${p ?? "(no file)"} names no change`);
        if (c.key !== undefined && st.shared.some((s) => s.key === c.key && (s.path ?? null) === p)) continue;
        const gen = generator(root, p, c);
        const s = { id: `S${++n}`, ...(c.key !== undefined ? { key: c.key } : {}), from: c.from ?? null, path: p, change: String(c.change), ...(c.reason !== undefined ? { reason: c.reason } : {}), ...gen.extra, applied: false, ...(c.wave ? { wave: String(c.wave) } : {}), ...(gen.missing ? { refused: gen.missing } : {}) };
        st.shared.push(s);
        (gen.missing ? refused : added).push(s.id);
      }
      return { added, refused };
    }
    if (op === "tag") {
      const wave = String(input.wave ?? "").trim();
      if (!wave) refuse("tag needs the wave that applies the changes");
      const tagged = st.shared.filter((s) => !s.applied && s.wave === undefined);
      for (const s of tagged) s.wave = wave;
      return { tagged: tagged.map((s) => s.id) };
    }
    if (op === "applied") {
      const ids = input.ids ?? [];
      const hit = ids.map((id) => st.shared.find((s) => s.id === id));
      hit.forEach((s, i) => {
        if (!s) refuse(`no shared change ${ids[i]}`);
        if (s.applied) refuse(`shared change ${s.id} is applied already`);
        if (s.refused) refuse(`shared change ${s.id} is refused (${s.refused}); only the owner clears it`);
        if (!s.path) refuse(`shared change ${s.id} names no file, so nothing shows it applied`);
      });
      for (const s of hit) s.applied = true;
      return { applied: ids, closed: input.link ? closeLinked(st, hit, "was applied") : [] };
    }
    refuse(`op ${JSON.stringify(op)} is not add|tag|applied`);
  });
}

// {op: route, plan, from, path, change, reason?, via?, outputs?, base?} | {op: close, plan, from, path, change, by, why}
export function stateRequest(root, phaseDir, input) {
  const op = input?.op;
  if (op === "close" && (BY_ALIAS[input.by] ?? input.by) === "owner") return { status: "refused", reason: "a request is closed by the owner only through ph gsd request clear, taken with state-answer", code: 1, state: readState(root, phaseDir) };
  return update(root, phaseDir, (st) => {
    const plan = String(input?.plan ?? "");
    if (!PLAN_ID.test(plan)) refuse(`plan ${JSON.stringify(input?.plan)} is not a plan id NN-MM`);
    const p = relPath(input.path, "path");
    if (op === "route") {
      if (isKitDoc(p)) refuse(`${p} is the project's kit-feedback document: an observation about the kit is a kitNote, not a request`);
      if (st.plans[plan]?.commit !== undefined) refuse(`plan ${plan} is committed: a change to its files is a shared change`);
      if (!String(input.change ?? "").trim()) refuse(`the request for ${p} names no change`);
      const gen = generator(root, p, input);
      if (gen.missing) return refuseGenerated(gen.missing);
      const q = { from: input.from ?? null, path: p, change: String(input.change), ...(input.reason !== undefined ? { reason: input.reason } : {}), ...gen.extra };
      const key = requestKey(plan, q);
      if ((st.requests[plan] ?? []).some((x) => requestKey(plan, x) === key)) return { routed: false, duplicate: true };
      (st.requests[plan] ??= []).push(q);
      if (input.base === true) st.requestBase[key] = digestOf(root, p);
      return { routed: true };
    }
    if (op === "close") {
      const by = BY_ALIAS[input.by] ?? input.by;
      if (!CLOSE_BY.includes(by)) refuse(`by ${JSON.stringify(input.by)} is not one of ${CLOSE_BY.join("|")}`);
      const key = requestKey(plan, { from: input.from ?? null, path: p, change: input.change ?? null });
      const q = (st.requests[plan] ?? []).find((x) => requestKey(plan, x) === key);
      if (!q) refuse(`no open request of ${plan} for ${p} from ${input.from ?? "(none)"}`);
      let why = String(input.why ?? "").trim();
      if (by === "tree") {
        if (!Object.hasOwn(st.requestBase, key)) refuse(`no digest of ${p} was recorded at the request`);
        if (digestOf(root, p) === st.requestBase[key]) refuse(`${p} is unchanged since the request`);
        why ||= `${p} changed after the request`;
      } else if (by === "shared change") {
        const s = st.shared.find((x) => x.applied && [x.path, ...(x.outputs ?? [])].some((o) => o && slash(o) === p));
        if (!s) refuse(`no applied or cleared shared change names ${p}`);
        why ||= `the shared change to ${slash(s.path)} (${s.from ?? "declared"}) ${s.cleared ? "was cleared by the owner" : "was applied"}`;
      } else if (by === "resolver" && !why) refuse("a resolver closure needs the resolver's evidence (why)");
      return { closed: closeOne(st, plan, q, by, why || "named in resolvedRequests") };
    }
    refuse(`op ${JSON.stringify(op)} is not route|close`);
  });
}

// {op: add, files, why}
export function stateIntegration(root, phaseDir, input) {
  return update(root, phaseDir, (st) => {
    if (input?.op !== "add") refuse(`op ${JSON.stringify(input?.op)} is not add`);
    const why = String(input.why ?? "").trim();
    if (!why) refuse("integration files need the reason they are the run's own output (why)");
    if (!Array.isArray(input.files)) refuse("files is not a list of paths");
    return { added: addIntegration(st, input.files.map((f) => relPath(f, "file")), why) };
  });
}

// {id, link?}: takes one owner answer of owner-answers.json (kit feedback 83 F3) and records it taken, in one write.
export function stateAnswer(root, phaseDir, input) {
  const dir = resolveInside(root, phaseDir);
  const { answers } = readAnswers(path.join(dir, OWNER_ANSWERS_FILE));
  return update(root, phaseDir, (st) => {
    const x = answers.find((a) => a.id === input?.id);
    if (!x) refuse(`no owner answer ${JSON.stringify(input?.id)} in ${slash(phaseDir)}/${OWNER_ANSWERS_FILE}`);
    if (!["shared", "request"].includes(x.kind)) refuse(`answer ${x.id} is a ${x.kind} answer; gsd-execute takes shared and request answers`);
    if (st.answered.includes(x.id)) refuse(`answer ${x.id} is taken already`);
    let matched = 0;
    let closed = [];
    if (x.kind === "shared") {
      const hit = st.shared.filter((s) => !s.applied && (s.wave === undefined || waveMatches(s.wave, x.wave)) && (!x.path || slash(s.path ?? "") === x.path));
      for (const s of hit) {
        s.applied = true;
        s.cleared = { answer: x.id, reason: x.reason };
      }
      addIntegration(st, hit.flatMap((s) => [s.path, ...(s.outputs ?? [])]).filter(Boolean), `owner answer ${x.id}`);
      if (input.link) closed = closeLinked(st, hit, "was cleared by the owner");
      matched = hit.length;
    } else {
      for (const q of [...(st.requests[x.plan] ?? [])].filter((y) => slash(y.path) === x.path)) { closed.push(closeOne(st, x.plan, q, "owner", x.reason)); matched++; }
    }
    st.answered.push(x.id);
    return { taken: { id: x.id, kind: x.kind, ...(x.plan ? { plan: x.plan } : {}), ...(x.wave ? { wave: x.wave } : {}), ...(x.path ? { path: x.path } : {}), reason: x.reason, matched }, closed };
  });
}

// {wave, changed}: the smoke build of the phase passed (F57); a resumed run does not build again.
export function stateSmoke(root, phaseDir, input) {
  return update(root, phaseDir, (st) => {
    const wave = String(input?.wave ?? "").trim();
    if (!wave || !Array.isArray(input.changed)) refuse("smoke needs {wave, changed: [path]}");
    st.smoke = { wave, changed: input.changed.map(slash) };
    return {};
  });
}
