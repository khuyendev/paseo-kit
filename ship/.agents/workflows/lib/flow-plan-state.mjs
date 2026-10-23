// Planning state (kit feedback 87, part B for gsd-plan; items 40, 67, 69, 71, 73, 76): the one writer of
// <phaseDir>/plan-progress.json. gsd-plan keeps the step order and its policy (caps, which plans a check judges, when to stop);
// the bookkeeping those steps share lives here as typed records, each written by one verb under the record's lock:
//   run, instance  the run and its start (plan-run): a `--resume` keeps the run id and starts the next instance; `open` while an
//                  instance runs (plan-end closes it), so a start of the same run after an instance that never ended (a killed
//                  runner) is a resume, and one after an ended instance is a new run (tests reuse a run id); `since` is the first
//                  instance of the run
//   outline        the outline this run's writer wrote: the inputs digest it was written for and its file digest (plan-outline);
//                  a resumed run keeps it instead of writing it again
//   settings       the settings digests the run checks and records plans with (plan-run; `revisions record` reuses them, item 73)
//   force          the run's forceProceed {reason, issues}
//   plans          per plan, the instance whose planner last wrote it (forceProceed never accepts it there, item 40) and the one that
//                  last recorded it (a resumed run keeps a plan this run recorded and its own steps changed since) (plan-mark)
//   logs           per part (a checker loop, the streams join, the dependency checks, the contract gate, the reallocation rounds,
//                  the recheck scope), the instance's op log; its fold is the part's state (plan-checker, plan-contracts,
//                  plan-realloc, plan-recheck)
//   seen, accepted the forceProceed issues the instance met, and what its override accepted (item 71)
//   changes        the contract changes the run applied (all its instances): a resumed reviser's `contracts change` answers
//                  `already`, and this says it was the run's own change, so its consumers are still revised (item 67)
// A verb call names {run, part, step, ops}; `step` is an id the workflow gives in a fixed order, so the fold of a log is a function
// of the ops sent: a resumed run that sends the same ops gets the same answers. The same step sent again with the same ops is
// answered from the log without a write; with other ops it replaces its entry in place.
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "../../harness/gsd/common.mjs";
import { readJsonIf, writeJsonAtomic } from "../../harness/lib/io.mjs";
import { resolveInside } from "../../harness/lib/paths.mjs";

export const PLAN_STATE_FILE = "plan-progress.json";
export const PLAN_STATE_VERSION = 1;
export const PLAN_STAGES = Object.freeze(["planned", "recorded"]);
const PART = /^(checker(:[A-Za-z0-9._-]+)?|gaps|join|dependents|contracts|realloc|recheck)$/;
const PLAN_ID = /^\d+(\.\d+)?-\d+$/;

export const isPlanStateFile = (rel) => path.basename(String(rel ?? "").replace(/\\/g, "/")) === PLAN_STATE_FILE;
const stateFile = (root, phaseDir) => path.join(resolveInside(root, phaseDir), PLAN_STATE_FILE);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const fail = (why) => { throw Object.assign(new Error(why), { refused: true }); };

function fresh() {
  return { version: PLAN_STATE_VERSION, rev: 0, run: null, instance: 0, since: 0, open: false, force: null, settings: {}, plans: {}, outline: null, logs: {}, seen: [], accepted: null, changes: [] };
}
const instanceOf = (st) => `${st.run}#${st.instance}`;
// The instance number of a mark of this run, else null.
const markOf = (st, mark) => {
  const m = /^(.*)#(\d+)$/.exec(String(mark ?? ""));
  return m && m[1] === st.run && Number(m[2]) >= st.since ? Number(m[2]) : null;
};

function check(data, file) {
  const bad = (what) => { throw new Error(`${file}: ${what}; it is written only by the plan-* flow verbs`); };
  if (!isObj(data)) bad("not a JSON object");
  if (data.version !== undefined && !(Number.isInteger(data.version) && data.version <= PLAN_STATE_VERSION)) bad(`version ${data.version} is newer than this kit (${PLAN_STATE_VERSION})`);
  if (data.plans !== undefined && (!isObj(data.plans) || Object.values(data.plans).some((p) => !isObj(p) || PLAN_STAGES.some((k) => p[k] !== undefined && typeof p[k] !== "string")))) bad("plans is not {<id>: {planned, recorded}}");
  if (data.logs !== undefined && (!isObj(data.logs) || Object.values(data.logs).some((l) => !Array.isArray(l) || l.some((e) => !isObj(e) || typeof e.step !== "string" || !Array.isArray(e.ops))))) bad("logs is not {<part>: [{step, ops}]}");
  if (data.settings !== undefined && !isObj(data.settings)) bad("settings is not an object");
  if (data.seen !== undefined && !Array.isArray(data.seen)) bad("seen is not a list");
  if (data.changes !== undefined && !Array.isArray(data.changes)) bad("changes is not a list");
  if (data.instance !== undefined && !(Number.isInteger(data.instance) && data.instance >= 0)) bad("instance is not a count");
}

/** The typed state of a plan-progress.json (a fresh one when there is none); never writes. */
export function readPlanStateFile(file) {
  const data = readJsonIf(file, null);
  if (data === null) return fresh();
  check(data, file);
  return { ...fresh(), ...data, version: PLAN_STATE_VERSION, rev: Number.isInteger(data.rev) ? data.rev : 0 };
}
export const readPlanState = (root, phaseDir) => readPlanStateFile(stateFile(root, phaseDir));

// One locked read-modify-write; fn returns {reply, write}: a replay answers without writing.
function update(root, phaseDir, fn) {
  const file = stateFile(root, phaseDir);
  if (!fs.existsSync(path.dirname(file))) fail(`${phaseDir} does not exist`);
  return withFileLock(`${file}.lock`, () => {
    const st = readPlanStateFile(file);
    let out;
    try { out = fn(st); } catch (e) {
      if (e.refused) return { status: "refused", reason: e.message, code: 1 };
      throw e;
    }
    if (out.write !== false) {
      st.rev += 1;
      writeJsonAtomic(file, st);
    }
    return { status: "ok", rev: st.rev, ...out.reply };
  });
}

// ---- issue helpers (as gsd-plan's checker loop had them) ----
const cut300 = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 300);
const keyOf = (scope, i) => (i.plan && (scope ?? []).includes(i.plan) ? i.plan : null);
// The same blocker as an earlier checker iteration raised it: same plan, dimension and invariant.
const sameIssue = (a, b) => (a.plan ?? null) === (b.plan ?? null) && a.dimension === b.dimension && a.required_property === b.required_property;
export const dimensionOf = (i) => String(i.dimension || i.probe || "").trim().toLowerCase();
const isBlocker = (i) => i.severity === "blocker";
const blockerOf = (scope, list, key) => list.filter((i) => isBlocker(i) && keyOf(scope, i) === key);
const groupBy = (list, fn) => {
  const out = [];
  for (const i of list) {
    const k = fn(i);
    const g = out.find(([x]) => x === k);
    if (g) g[1].push(i);
    else out.push([k, [i]]);
  }
  return out;
};
const pairGet = (pairs, k) => pairs.find(([x]) => x === k)?.[1];
const pairSet = (pairs, k, v) => {
  const g = pairs.find(([x]) => x === k);
  if (g) g[1] = v;
  else pairs.push([k, v]);
};
const pairHas = (pairs, k) => pairs.some(([x]) => x === k);
const stuckWhy = (key, why) => `${key ?? "phase"}: ${why}`;

// Kit feedback 64: the checker ledger, one entry per distinct issue (same plan, dimension and invariant). A blocker entry closes
// when a check confirms it resolved (applied) or its revision conflicts; the same blocker raised again after that is a new entry.
function ledgerOf(prefix, entries) {
  const same = (x, i) => (x.plan ?? null) === (i.plan ?? null) && x.dimension === i.dimension && x.required_property === i.required_property;
  const entryOf = (i, severity) => {
    let e = entries.find((x) => x.severity === severity && same(x, i) && (severity !== "blocker" || x.fate === null));
    if (!e) entries.push((e = { id: `${prefix}${entries.length + 1}`, plan: i.plan ?? null, dimension: i.dimension, required_property: i.required_property, severity, description: i.description ?? "", fate: null }));
    return e;
  };
  const add = (list) => { for (const i of list ?? []) entryOf(i, ["info", "warning"].includes(String(i.severity).toLowerCase()) ? String(i.severity).toLowerCase() : "blocker"); };
  const settle = (pick, fate) => { for (const e of entries) if (e.fate === null && e.severity === "blocker" && pick(e)) e.fate = fate; };
  const findings = () => entries.map((e) => {
    const blocking = e.severity === "blocker";
    const fate = e.fate ?? (blocking ? "open" : "carried");
    return { id: e.id, plan: e.plan, class: e.dimension || (prefix === "D" ? "dependency" : "checker"), dimension: e.dimension ?? "", required_property: cut300(e.required_property), severity: e.severity, blocking, confirmed: blocking && fate === "applied", fate, description: cut300(e.description) };
  });
  return { same, entryOf, add, settle, findings };
}

// Kit feedback 71: a blocker forceProceed.issues names ({plan, dimension}) is taken out of the list and noted in `seen`.
function takeAccepted(st, list, scope) {
  const forced = st.force?.issues ?? null;
  if (!forced) return list;
  return list.filter((i) => {
    if (i.severity !== "blocker") return true;
    const plan = keyOf(scope, i);
    if (!forced.some((f) => f.plan === plan && f.dimension.trim().toLowerCase() === dimensionOf(i))) return true;
    if (!st.seen.some((x) => x.plan === plan && x.dimension === dimensionOf(i) && x.description === (i.description ?? ""))) st.seen.push({ plan, dimension: dimensionOf(i), description: i.description ?? "" });
    return false;
  });
}

// ---- the checker parts: a loop (checker, checker:<part>, gaps), the streams join (join) and the dependency checks (dependents) ----
function checkerFold(part) {
  const s = { scope: [], entries: [], tally: [], stuck: [], pending: [], carriedBy: [], lastRevise: [], join: null, routes: {}, deps: {}, dependents: [] };
  s.ledger = ledgerOf(part === "dependents" ? "D" : "K", s.entries);
  return s;
}
const nextEarlier = (s) => s.pending.filter((i) => !pairHas(s.stuck, keyOf(s.scope, i))).map((i, n) => ({ ...i, id: `open-${n + 1}` }));
const stuckView = (s) => s.stuck.map(([key, v]) => ({ key, why: v.why, issues: v.issues }));
const capOf = (cap) => {
  if (!Number.isInteger(cap) || cap < 1 || cap > 3) fail(`cap must be an integer 1..3, not ${cap}`);
  return cap;
};

const CHECKER_OPS = {
  // takeAccepted of a list (probe blockers before a round, the reallocation candidates).
  accept: (st, s, o) => ({ list: takeAccepted(st, o.list ?? [], o.scope ?? s.scope) }),
  // One checker-loop iteration after the checker replied (GSDF-26..28, kit feedback 9, 13, 20, 44): the earlier blockers it
  // confirmed resolved, the new pending set, the blockers per key, the cap and stall rule per key, the carried warnings.
  round: (st, s, o) => {
    s.scope = o.scope;
    const cap = capOf(o.cap);
    const earlier = nextEarlier(s);
    const confirmed = new Set(o.resolved ?? []);
    const kept = earlier.filter((i) => !confirmed.has(i.id));
    for (const i of earlier) if (confirmed.has(i.id)) s.ledger.entryOf(i, "blocker").fate = "applied";
    s.ledger.add(o.issues);
    const checkerIssues = o.checkerIssues ?? [];
    const probes = o.probes ?? [];
    const fresh = checkerIssues.filter(isBlocker);
    s.pending = takeAccepted(st, [...kept.filter((k) => !fresh.some((f) => sameIssue(k, f))), ...fresh], s.scope);
    const blockers = [...s.pending, ...takeAccepted(st, probes.filter(isBlocker), s.scope)];
    const carried = [...checkerIssues, ...probes].filter((i) => i.severity === "warning");
    const base = { blockers: blockers.length, confirmed: earlier.length - kept.length, earlier: earlier.length };
    const reallocate = o.reallocate ? blockers.filter((i) => i.outcome === "reallocate" && isBlocker(i) && Boolean(i.plan) && s.scope.includes(i.plan)) : [];
    if (reallocate.length) return { ...base, reallocate, revise: [], newlyStuck: [], next: [], stuck: stuckView(s) };
    for (const key of [...(o.live ?? []), null]) {
      if (!pairHas(s.stuck, key)) pairSet(s.carriedBy, key, carried.filter((w) => keyOf(s.scope, w) === key).map((w) => `checker${w.plan ? ` (${w.plan})` : ""}: ${w.description}`));
    }
    const revise = [];
    const newlyStuck = [];
    for (const [key, list] of groupBy(blockers, (i) => keyOf(s.scope, i))) {
      if (pairHas(s.stuck, key)) continue;
      const t = pairGet(s.tally, key) ?? { rounds: 0, prev: null };
      t.rounds++;
      pairSet(s.tally, key, t);
      if (t.rounds >= cap || (t.prev !== null && list.length >= t.prev)) {
        const why = t.rounds >= cap ? `checker cap ${cap} reached with ${list.length} issues` : `stalled: ${list.length} issues, not below ${t.prev}`;
        pairSet(s.stuck, key, { why: stuckWhy(key, why), issues: list });
        newlyStuck.push({ key, why });
      } else {
        t.prev = list.length;
        revise.push([key, list]);
      }
    }
    s.lastRevise = revise;
    return { ...base, reallocate: [], revise, newlyStuck, next: nextEarlier(s), stuck: stuckView(s) };
  },
  // Every plan is stuck: the keys the last round would revise stop with them.
  "stuck-all": (st, s) => {
    for (const [key, list] of s.lastRevise) pairSet(s.stuck, key, { why: stuckWhy(key, "no plan left to revise"), issues: list });
    return { stuck: stuckView(s) };
  },
  // A REVISION_CONFLICT closes the open blockers of the keys (keyOf) or plans it answered.
  conflict: (st, s, o) => {
    if (o.plans) s.ledger.settle((e) => o.plans.includes(e.plan), "conflict");
    else s.ledger.settle((e) => (o.keys ?? []).includes(keyOf(s.scope, e)), "conflict");
    return {};
  },
  // The streams join (O65): the checker reply over the frozen set, its blockers with ids, the keys to route.
  join: (st, s, o) => {
    s.scope = o.scope;
    s.ledger.add(o.issues);
    const checkerIssues = o.checkerIssues ?? [];
    const probes = o.probes ?? [];
    const found = takeAccepted(st, checkerIssues, s.scope).filter(isBlocker).map((i, n) => ({ ...i, id: `K${n + 1}` }));
    const carried = [...checkerIssues, ...probes].filter((i) => i.severity === "warning");
    const keys = [...new Set([...found, ...probes.filter(isBlocker)].map((i) => keyOf(s.scope, i)))];
    s.join = { found, probes, carried };
    return { found, carried, keys };
  },
  // One judgment round of a key's route stream: the cap and stall rule before its revision.
  route: (st, s, o) => {
    const cap = capOf(o.cap);
    const name = o.key ?? "phase";
    const r = s.routes[name] ?? (s.routes[name] = { open: [...blockerOf(s.scope, s.join?.found ?? [], o.key), ...blockerOf(s.scope, s.join?.probes ?? [], o.key)], prev: null, rounds: 0 });
    r.rounds = o.round;
    if (o.round >= cap || (r.prev !== null && r.open.length >= r.prev)) {
      const why = o.round >= cap ? `checker cap ${cap} reached with ${r.open.length} issues` : `stalled: ${r.open.length} issues, not below ${r.prev}`;
      return { stuck: { why: stuckWhy(o.key, why), issues: r.open }, log: why };
    }
    r.prev = r.open.length;
    return { open: r.open, asked: r.open.filter((i) => !i.probe) };
  },
  // After the route's revision: the blockers its resolution check confirmed, then this key's probe blockers.
  "route-done": (st, s, o) => {
    const name = o.key ?? "phase";
    const r = s.routes[name];
    if (!r) fail(`route ${name} has no round`);
    const asked = r.open.filter((i) => !i.probe);
    const resolved = new Set(o.resolved ?? []);
    for (const i of asked) if (resolved.has(i.id)) s.ledger.entryOf(i, "blocker").fate = "applied";
    const still = o.resolved === null ? [] : asked.filter((i) => !resolved.has(i.id));
    r.open = [...still, ...blockerOf(s.scope, takeAccepted(st, o.probes ?? [], s.scope), o.key)];
    return { open: r.open };
  },
  // A key the join stops with, in the order the workflow names them; `join` takes the key's blockers the join found.
  stuck: (st, s, o) => {
    if (typeof o.why !== "string" || !o.why) fail("a stuck key needs its why");
    const issues = o.join ? [...blockerOf(s.scope, s.join?.found ?? [], o.key ?? null), ...blockerOf(s.scope, s.join?.probes ?? [], o.key ?? null)] : o.issues ?? [];
    pairSet(s.stuck, o.key ?? null, { why: o.why, issues });
    return { stuck: stuckView(s) };
  },
  // The join's final probe pass: a probe blocker left over is stuck with its plan; the warnings carried into the result.
  final: (st, s, o) => {
    const last = takeAccepted(st, o.probes ?? [], s.scope);
    for (const i of last.filter(isBlocker)) {
      const k = keyOf(s.scope, i);
      const v = pairGet(s.stuck, k) ?? { why: stuckWhy(k, "probe blockers left after the routed revisions"), issues: [] };
      if (!v.issues.some((x) => x.probe === i.probe && x.description === i.description)) v.issues.push(i);
      pairSet(s.stuck, k, v);
    }
    const carried = s.join?.carried ?? [];
    const warnings = [...carried, ...last.filter((x) => x.severity === "warning" && !carried.some((y) => y.probe === x.probe && y.description === x.description))].map((w) => `checker${w.plan ? ` (${w.plan})` : ""}: ${w.description}`);
    const rounds = Object.fromEntries(Object.entries(s.routes).map(([k, v]) => [k, v.rounds]));
    return { last, warnings, rounds, stuck: stuckView(s) };
  },
  // One dependency check of a plan (O67) in its stream `stream`: blockers no longer raised were resolved by the revision; a stream
  // that ends (no blocker, or the cap and stall rule) is listed in `dependents` as the result shows it.
  dep: (st, s, o) => {
    const cap = capOf(o.cap);
    if (!PLAN_ID.test(String(o.plan))) fail(`dep needs a plan id, not ${o.plan}`);
    const open = (o.issues ?? []).filter((i) => String(i.severity).toLowerCase() === "blocker").map((i) => ({ ...i, plan: o.plan }));
    s.ledger.settle((e) => e.plan === o.plan && !open.some((x) => s.ledger.same(e, x)), "applied");
    s.ledger.add((o.issues ?? []).map((i) => ({ ...i, plan: o.plan })));
    const entry = { plan: o.plan, providers: o.providers ?? [], rounds: o.round, revised: o.round > 1 };
    if (!open.length) {
      s.dependents.push(entry);
      return { open, dependents: s.dependents };
    }
    const d = s.deps[o.stream] ?? (s.deps[o.stream] = { prev: null });
    if (o.round >= cap || (d.prev !== null && open.length >= d.prev)) {
      s.dependents.push({ ...entry, stuck: true });
      return { open, stuck: true, dependents: s.dependents };
    }
    d.prev = open.length;
    return { open, dependents: s.dependents };
  },
  // The end of a loop or join (GSDF-28, kit feedback 40, 71): passed, a stop, or what forceProceed accepts.
  settle: (st, s, o) => {
    const scope = o.scope ?? s.scope;
    const carried = s.carriedBy.flatMap(([, list]) => list);
    if (!s.stuck.length && !st.seen.length) return { carried, passed: true };
    const why = s.stuck.map(([, v]) => v.why).join("; ");
    const remaining = s.stuck.flatMap(([, v]) => v.issues);
    const listed = st.seen.map(({ plan, dimension, description }) => ({ plan, dimension, description }));
    const forced = st.force?.issues ?? null;
    // The forceProceed.issues that would accept the stuck issues (the answer of the stop), with the ones already named.
    const naming = (list) => [...new Map(list.map((i) => [`${i.plan}\0${i.dimension}`, i])).values()];
    const answer = naming([...(forced ?? []).map((f) => ({ plan: f.plan, dimension: f.dimension.trim().toLowerCase() })), ...remaining.map((i) => ({ plan: keyOf(scope, i), dimension: dimensionOf(i) }))]);
    if (s.stuck.length && !st.force) return { carried, stop: "stuck", why, issues: remaining, answer };
    // The issues forceProceed {reason, issues} named do not cover a stuck one: the run stops with both lists.
    if (s.stuck.length && forced) return { carried, stop: "uncovered", why, issues: remaining, accepted: listed, answer };
    const all = s.stuck.length > 0;
    const accepted = all ? remaining.map((x) => ({ plan: x.plan ?? null, dimension: dimensionOf(x), description: x.description ?? "" })) : listed;
    // F40: forceProceed accepts plans unchecked, so never a plan a planner of this run wrote; a rerun can.
    const plans = all ? s.stuck.flatMap(([key]) => (key === null ? scope : [key])) : accepted.flatMap((x) => (x.plan === null ? scope : [x.plan]));
    const fresh = [...new Set(plans.filter((id) => st.plans[id]?.planned === instanceOf(st)))];
    if (fresh.length) return { carried, stop: "fresh", plans: fresh, issues: all ? remaining : accepted };
    const unused = (forced ?? []).filter((f) => !accepted.some((x) => x.plan === f.plan && x.dimension === f.dimension.trim().toLowerCase()));
    const override = { reason: st.force.reason, mode: all ? "all" : "issues", why, remaining, accepted, ...(unused.length ? { unused } : {}) };
    const lines = accepted.map((x) => `${x.plan ?? "phase"}${x.dimension ? ` [${x.dimension}]` : ""}: ${x.description}`);
    st.accepted = { run: instanceOf(st), reason: st.force.reason, mode: override.mode, accepted, ...(unused.length ? { unused } : {}) };
    return { carried, override, lines, warnAll: all && !forced };
  },
  view: (st, s) => ({ findings: s.ledger.findings(), stuck: stuckView(s), dependents: s.dependents }),
};

// ---- the contract gate (kit feedback 67): changes applied in this run, dirty until the next gate, checks and rounds ----
function contractsFold() {
  return { checks: 0, rounds: 0, issues: 0, changes: [], dirty: false };
}
const contractReport = (s) => ({ checks: s.checks, rounds: s.rounds, issues: s.issues, changes: s.changes });
const CONTRACT_OPS = {
  // A reviser's CONTRACT_CHANGE as `ph gsd contracts change` answered it (outcome). An `already` answer is this run's change when an
  // earlier instance of the run applied it (the resume of a reviser's reply), else a change of an earlier run.
  change: (st, s, o) => {
    if (![o.symbol, o.new].every((v) => typeof v === "string" && v.trim())) fail("a contract change needs symbol and new");
    const out = o.outcome ?? {};
    const same = (c) => c.plan === out.plan && c.symbol === o.symbol && c.new === out.signature;
    const known = !out.changed && out.already ? st.changes.find(same) : null;
    if (!out.changed && !known) return { changed: false, dirty: s.dirty, report: contractReport(s) };
    const entry = known ? { ...known, reason: o.reason } : { plan: out.plan, symbol: o.symbol, old: out.old, new: out.signature, reason: o.reason, consumers: out.consumers ?? [] };
    if (!st.changes.some(same)) st.changes.push(entry);
    s.changes.push(entry);
    s.dirty = true;
    return { changed: true, entry, dirty: s.dirty, report: contractReport(s) };
  },
  // One `ph gsd verify contracts` of a gate round; `errors` is its error count when it did not pass.
  check: (st, s, o) => {
    s.checks++;
    if (o.errors) s.issues = Math.max(s.issues, o.errors);
    return { dirty: s.dirty, report: contractReport(s) };
  },
  round: (st, s) => {
    s.rounds++;
    return { dirty: s.dirty, report: contractReport(s) };
  },
  clean: (st, s) => {
    s.dirty = false;
    return { dirty: s.dirty, report: contractReport(s) };
  },
  view: (st, s) => ({ dirty: s.dirty, report: contractReport(s) }),
};

// ---- reallocation rounds (kit feedback 69): a round is used when it begins and listed once its outline changed ----
const REALLOC_OPS = {
  begin: (st, s, o) => {
    if (!Number.isInteger(o.rounds) || o.rounds < 1) fail(`rounds must be a positive integer, not ${o.rounds}`);
    if (s.used >= o.rounds) fail(`no reallocation round left (${s.used} of ${o.rounds} used)`);
    s.used++;
    return { round: s.used, left: o.rounds - s.used, reallocated: s.done };
  },
  done: (st, s, o) => {
    if (!Array.isArray(o.plans) || !o.plans.length) fail("a reallocation names its plans");
    s.done.push({ round: o.round, plans: o.plans, changed: o.changed ?? [], removed: o.removed ?? [], issues: o.issues ?? [] });
    return { reallocated: s.done };
  },
  view: (st, s) => ({ used: s.used, reallocated: s.done }),
};

// ---- recheck scope (kit feedback 76 F2): which plans the checker agent judges after a plan edit ----
const RECHECK_OPS = {
  // From `revisions check checked` (and `checkedbody` once plan files alone changed): a full check, or the changed plans.
  scope: (st, s, o) => {
    const scope = o.scope ?? [];
    const dir = String(o.phaseDir ?? "");
    const planOf = (label) => (label.startsWith(`${dir}/`) && label.endsWith("-PLAN.md") && scope.includes(label.slice(dir.length + 1, -"-PLAN.md".length)) ? label.slice(dir.length + 1, -"-PLAN.md".length) : null);
    const labels = o.checked?.changed;
    if (!Array.isArray(labels) || !labels.length) return { full: o.checked?.code === 66 ? "no earlier passing check" : "the changed parts are unknown" };
    const other = labels.filter((l) => planOf(l) === null);
    if (other.length) return { full: `not a plan edit: ${other.join(", ")}` };
    const changed = labels.map(planOf);
    if (o.body === undefined) return { changed };
    const bodyLabels = o.body === null || o.body.code === 66 || !Array.isArray(o.body.changed) ? null : o.body.changed;
    return { changed, bodyChanged: bodyLabels ? changed.filter((id) => bodyLabels.some((l) => planOf(l) === id)) : changed };
  },
  record: (st, s, o) => {
    s.report = { mode: "incremental", changed: o.changed ?? [], bodyChanged: o.bodyChanged ?? [], linked: o.linked ?? [], agent: o.agent ?? [] };
    return { recheck: s.report };
  },
  view: (st, s) => ({ recheck: s.report ?? null }),
};

const FAMILIES = {
  checker: { test: (p) => /^(checker(:.+)?|gaps|join|dependents)$/.test(p), init: checkerFold, ops: CHECKER_OPS },
  contracts: { test: (p) => p === "contracts", init: contractsFold, ops: CONTRACT_OPS },
  realloc: { test: (p) => p === "realloc", init: () => ({ used: 0, done: [] }), ops: REALLOC_OPS },
  recheck: { test: (p) => p === "recheck", init: () => ({ report: null }), ops: RECHECK_OPS },
};

// The ops of a step without their outcomes: what a replay compares.
const identity = (ops) => JSON.stringify(ops.map(({ outcome, ...rest }) => rest));

// Folds a part's log up to and including index `upto`; the replies are those of that last step.
function fold(st, family, part, log, upto) {
  const s = family.init(part);
  let replies = [];
  for (let k = 0; k <= upto; k++) replies = log[k].ops.map((o) => family.ops[o.op](st, s, o));
  return { s, replies };
}

function stepVerb(root, phaseDir, input, verb, familyName) {
  const family = FAMILIES[familyName];
  const { run, part, step, ops } = input ?? {};
  return update(root, phaseDir, (st) => {
    if (typeof run !== "string" || !run) fail(`${verb} needs the run id`);
    if (st.run !== run) fail(`${verb}: ${PLAN_STATE_FILE} belongs to run ${st.run ?? "none"}, not ${run}; plan-run starts the run's record first`);
    if (typeof part !== "string" || !PART.test(part) || !family.test(part)) fail(`${verb}: part ${JSON.stringify(part)} is not one of this verb's parts`);
    if (typeof step !== "string" || !step) fail(`${verb} needs a step id`);
    if (!Array.isArray(ops) || !ops.length) fail(`${verb} needs a non-empty ops list`);
    for (const o of ops) if (!isObj(o) || !Object.hasOwn(family.ops, o.op) || o.op === "view") fail(`${verb}: unknown op ${JSON.stringify(o?.op)} (one of ${Object.keys(family.ops).filter((k) => k !== "view").join(", ")})`);
    const log = st.logs[part] ?? [];
    let at = log.findIndex((e) => e.step === step);
    // The same step again: its logged entry and outcomes stand.
    if (at !== -1 && log[at].ops.length === ops.length && identity(log[at].ops) === identity(ops)) {
      const { replies } = fold(structuredClone(st), family, part, log, at);
      return { write: false, reply: { again: true, replies } };
    }
    const next = [...log];
    if (at === -1) at = next.push({ step, ops }) - 1;
    else next[at] = { step, ops };
    const { replies } = fold(st, family, part, next, at);
    st.logs = { ...st.logs, [part]: next };
    return { reply: { replay: false, replies } };
  });
}

// A part's state after its whole log, for reading (plan-state).
function viewOf(st, part) {
  const familyName = Object.keys(FAMILIES).find((f) => FAMILIES[f].test(part));
  if (!familyName) return null;
  const family = FAMILIES[familyName];
  const log = st.logs[part] ?? [];
  const s = family.init(part);
  const copy = structuredClone(st);
  for (const e of log) for (const o of e.ops) family.ops[o.op](copy, s, o);
  return family.ops.view(copy, s, {});
}

// ---- verbs ----

/** plan-run {run, settings: {freeze, plan, checked}, force: {reason, issues}|null}: starts the next instance of the run (a new run: the
 * first). The logs, the forceProceed issues met and the planned marks belong to the instance; the contract changes to the run. */
export function planRun(root, phaseDir, { run, settings, force = null } = {}) {
  return update(root, phaseDir, (st) => {
    if (typeof run !== "string" || !run) fail("plan-run needs the run id");
    if (!isObj(settings) || !["freeze", "plan", "checked"].every((k) => typeof settings[k] === "string" && settings[k])) fail("plan-run needs settings {freeze, plan, checked} digests");
    if (force !== null && (!isObj(force) || typeof force.reason !== "string" || !force.reason.trim())) fail("force needs a non-empty reason");
    if (force?.issues != null && (!Array.isArray(force.issues) || force.issues.some((i) => !isObj(i) || typeof i.dimension !== "string" || !(i.plan === null || typeof i.plan === "string")))) fail("force.issues is a list of {plan, dimension}");
    const resumed = st.run === run && st.open === true;
    st.instance = st.run === run ? st.instance + 1 : 1;
    if (!resumed) {
      st.since = st.instance;
      st.changes = [];
      st.outline = null;
    }
    st.open = true;
    st.logs = {};
    st.seen = [];
    st.accepted = null;
    st.run = run;
    st.settings = { freeze: settings.freeze, plan: settings.plan, checked: settings.checked };
    st.force = force ? { reason: force.reason, issues: force.issues ?? null } : null;
    // A resumed run: the plans an earlier instance recorded (so complete then), and the outline it wrote.
    const recorded = resumed ? Object.keys(st.plans).filter((id) => { const n = markOf(st, st.plans[id].recorded); return n !== null && n < st.instance; }).sort() : [];
    return { reply: { resumed, instance: instanceOf(st), recorded, outline: resumed ? st.outline : null } };
  });
}

/** plan-end {run}: the instance ended with a result (not killed). */
export function planEnd(root, phaseDir, { run } = {}) {
  return update(root, phaseDir, (st) => {
    if (st.run !== run || !st.open) return { write: false, reply: { open: false } };
    st.open = false;
    return { reply: { open: false } };
  });
}

/** plan-outline {run, inputs, sha}: this run's outline writer wrote the outline (file digest sha) for the inputs digest. */
export function planOutline(root, phaseDir, { run, inputs, sha } = {}) {
  return update(root, phaseDir, (st) => {
    if (st.run !== run) fail(`plan-outline: ${PLAN_STATE_FILE} belongs to run ${st.run ?? "none"}, not ${run}`);
    if (![inputs, sha].every((v) => typeof v === "string" && v)) fail("plan-outline needs the inputs digest and the outline's digest");
    st.outline = { instance: instanceOf(st), inputs, sha };
    return { reply: { outline: st.outline } };
  });
}

/** plan-mark {run, plans, stage: planned|recorded}: a planner of this instance writes these plans, or the instance recorded them. */
export function planMark(root, phaseDir, { run, plans, stage } = {}) {
  return update(root, phaseDir, (st) => {
    if (st.run !== run) fail(`plan-mark: ${PLAN_STATE_FILE} belongs to run ${st.run ?? "none"}, not ${run}`);
    if (!PLAN_STAGES.includes(stage)) fail(`stage must be one of ${PLAN_STAGES.join(", ")}, not ${stage}`);
    if (!Array.isArray(plans) || !plans.length || plans.some((p) => !PLAN_ID.test(String(p)))) fail("plans is a non-empty list of plan ids NN-MM");
    if (plans.every((p) => st.plans[p]?.[stage] === instanceOf(st))) return { write: false, reply: { plans: st.plans } };
    st.plans = { ...st.plans };
    for (const p of plans) st.plans[p] = { ...(st.plans[p] ?? {}), [stage]: instanceOf(st) };
    return { reply: { plans: st.plans } };
  });
}

/** plan-state: the record and every part's folded view. */
export function planState(root, phaseDir) {
  const st = readPlanState(root, phaseDir);
  const views = Object.fromEntries(Object.keys(st.logs).map((p) => [p, viewOf(st, p)]));
  return { status: "ok", state: st, views };
}

export const planChecker = (root, phaseDir, input) => stepVerb(root, phaseDir, input, "plan-checker", "checker");
export const planContracts = (root, phaseDir, input) => stepVerb(root, phaseDir, { ...input, part: "contracts" }, "plan-contracts", "contracts");
export const planRealloc = (root, phaseDir, input) => stepVerb(root, phaseDir, { ...input, part: "realloc" }, "plan-realloc", "realloc");
export const planRecheck = (root, phaseDir, input) => stepVerb(root, phaseDir, { ...input, part: "recheck" }, "plan-recheck", "recheck");
