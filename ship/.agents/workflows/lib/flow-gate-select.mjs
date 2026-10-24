// Kit feedback 125 and W12: which obligations a gate runs. Step selection, suite-report reuse and
// metric recording. Failure parsing stays in flow-gate.mjs (H119).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf, readText } from "../../harness/lib/io.mjs";
import { resolveInside, toSlash } from "../../harness/lib/paths.mjs";
import { status } from "./flow-git.mjs";
import { owned, ownsPrefixes } from "./flow-owns.mjs";

// Absent gsd.wave_regression_cap. A small number: the cheapest intersecting earlier obligations, the rest listed.
export const DEFAULT_WAVE_REGRESSION_CAP = 3;
const REPORT_MAX_BYTES = 32 * 1024 * 1024;

const PASS = new Set(["passed", "pass", "ok", "success", "succeeded"]);
const FAIL = new Set(["failed", "fail", "failure", "error"]);
const MISS = new Set(["skipped", "missing", "not-run", "notrun", "not_run", "incomplete"]);

// The runner timeout, the cost of an obligation (lower runs first). Unknown kinds sort last.
export function obligationCost(cfg, ob) {
  const entry = cfg.adapter?.verify_vocabulary?.[ob?.kind];
  const commands = cfg.adapter?.commands ?? {};
  if (!entry) return Number.POSITIVE_INFINITY;
  if (entry.runner != null && commands.verify?.[entry.runner]) return commands.verify[entry.runner].timeout_s;
  if (ob.kind === "build") return commands.build_timeout_s ?? Number.POSITIVE_INFINITY;
  return commands.test_timeout_s ?? Number.POSITIVE_INFINITY;
}

// Files this gate's plans have dirty (the wave's diff). Planning records and the suite report are not part of it.
function changedFiles(root, plans, prefixes, ignore) {
  let entries;
  try {
    entries = status(root);
  } catch {
    return [];
  }
  const skip = (rel) => rel.startsWith(".planning/") || rel.startsWith("_workspace/") || rel.startsWith(".git/") || ignore.has(rel);
  const out = new Set();
  for (const e of entries) {
    const rel = toSlash(e.path).replace(/^\.\//, "");
    if (!rel || skip(rel)) continue;
    if (plans.some((p) => owned(rel, p.owns ?? [], prefixes))) out.add(rel);
  }
  return [...out].sort();
}

// A verify target or command names a changed file when the path is that file (or a suffix of it). A short token does not.
function filesNamedBy(target, command, changed) {
  const t = toSlash(String(target ?? "")).replace(/^\.\//, "");
  const cmd = toSlash(String(command ?? ""));
  return changed.filter((f) => {
    if (t && (f === t || f.endsWith(`/${t}`) || (t.includes("/") && t.endsWith(`/${f}`)))) return true;
    return Boolean(f.includes("/") && cmd.includes(f));
  });
}

const WAVE_FILE = /^(.*?)w(\d+)\.args\.json$/;

function readWaves(root, phaseDir, notes) {
  let dir;
  try {
    dir = path.join(resolveInside(root, phaseDir), "handoff");
  } catch {
    return [];
  }
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const m = WAVE_FILE.exec(name);
    if (!m) continue;
    let h;
    try {
      h = readJsonIf(path.join(dir, name), null);
    } catch (e) {
      notes.push(`handoff ${name} unreadable (${e.message}); earlier obligations not taken from it`);
      continue;
    }
    if (!h || typeof h.waveId !== "string" || !Array.isArray(h.tasks)) continue;
    out.push({ prefix: m[1], n: Number(m[2]), waveId: h.waveId, tasks: h.tasks });
  }
  return out;
}

// Candidates: earlier plans of this handoff wave whose files or verify targets the wave's diff touches.
function candidatesOf(root, cfg, { waveId, plans, phaseDir }, notes) {
  const waves = readWaves(root, phaseDir, notes);
  const here = waves.find((w) => w.waveId === waveId);
  if (!here) return { list: [], matched: false, earlier: 0 };
  const prefixes = ownsPrefixes(root);
  const mine = new Set((plans ?? []).map((p) => p.id));
  const ignore = new Set(cfg.adapter?.test_report?.path ? [toSlash(cfg.adapter.test_report.path)] : []);
  const changed = changedFiles(root, plans ?? [], prefixes, ignore);
  const earlier = waves.filter((w) => w.prefix === here.prefix && w.n < here.n).sort((a, b) => a.n - b.n);
  const earlierCount = earlier.reduce((n, w) => n + w.tasks.length, 0);
  const list = [];
  for (const w of earlier) for (const t of w.tasks) {
    if (!t || typeof t.plan !== "string" || mine.has(t.plan)) continue;
    const owns = Array.isArray(t.owns) ? t.owns : [];
    const verify = Array.isArray(t.verify) ? t.verify : [];
    const planHits = changed.filter((f) => owned(f, owns, prefixes));
    verify.forEach((ob, i) => {
      const named = filesNamedBy(ob?.target, ob?.command, changed);
      const files = [...new Set([...planHits, ...named])].sort();
      if (!files.length) return;
      const touched = (plans ?? []).filter((p) => files.some((f) => owned(f, p.owns ?? [], prefixes))).map((p) => p.id);
      if (!touched.length) return;
      list.push({
        plan: { id: t.plan, owns, verify },
        ob,
        index: i,
        cost: obligationCost(cfg, ob),
        regression: { of: t.plan, wave: waveId, plans: touched, files },
      });
    });
  }
  return { list, matched: true, earlier: earlierCount };
}

// The earlier obligations a wave gate runs, cheapest first, up to the cap. suite false keeps today's contract and says so
// when this wave would have had candidates. A waveId that is not a handoff wave (batch, phase, join) adds nothing.
export function earlierObligations(root, cfg, input, namesOf) {
  const notes = [];
  const cap = Number.isInteger(cfg.gsd?.wave_regression_cap) ? cfg.gsd.wave_regression_cap : DEFAULT_WAVE_REGRESSION_CAP;
  const found = candidatesOf(root, cfg, input, notes);
  const list = found.list;
  if (input.suite === false) {
    if (list.length) notes.push(`suite false: earlier obligations not added (${list.map((c) => `${c.plan.id} ${c.ob?.kind ?? "obligation"}`).join(", ")})`);
    return { selected: [], skipped: [], notes };
  }
  if (found.matched && found.earlier && !list.length) notes.push("no earlier obligation intersects this wave's diff");
  // Names follow obligationStepNames over the plan's whole verify list, so evidence-check finds the step.
  const named = [];
  const grouped = new Map();
  for (const c of list) {
    if (!grouped.has(c.plan.id)) grouped.set(c.plan.id, []);
    grouped.get(c.plan.id).push(c);
  }
  for (const [id, group] of grouped) {
    const plan = group[0].plan;
    const names = namesOf(id, plan.verify);
    for (const c of group) named.push({ ...c, name: names[c.index] });
  }
  named.sort((a, b) => a.cost - b.cost || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const selected = named.slice(0, Math.max(0, cap));
  const skipped = named.slice(Math.max(0, cap)).map((c) => ({
    plan: c.plan.id,
    step: c.name,
    command: typeof c.ob?.command === "string" ? c.ob.command : "",
    cost: Number.isFinite(c.cost) ? c.cost : null,
    reason: "cap",
  }));
  for (const s of skipped) notes.push(`earlier obligation ${s.step} skipped (cost ${s.cost ?? "?"}s, cap ${cap}): ${s.command}`);
  for (const s of selected) notes.push(`${s.name}: regression of ${s.regression.of} on ${s.regression.plans.join(", ")} (wave ${s.regression.wave}) via ${s.regression.files.join(", ")}`);
  return { selected, skipped, notes };
}

const flagsOf = (argv) => (argv ?? []).filter((w) => typeof w === "string" && w.startsWith("-"));
const positional = (argv) => (argv ?? []).filter((w) => typeof w === "string" && !w.startsWith("-"));
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

const withoutTimeout = (argv, timeoutArgv) => {
  if (!timeoutArgv?.length || !argv) return argv ?? [];
  const out = [...argv];
  for (let i = 0; i <= out.length - timeoutArgv.length; i++) {
    if (timeoutArgv.every((w, k) => out[i + k] === w)) { out.splice(i, timeoutArgv.length); break; }
  }
  return out;
};

// The obligation only narrows the suite command: same program, the same flags, and every extra positional a target
// (the suite's last positional may be replaced by the filter). The kit's per-test timeout args are ignored on both
// sides. --profile, a different script, or a dropped flag is not a pure filter.
export function pureTestFilter(testArgv, argv, targets, timeoutArgv = []) {
  const test = withoutTimeout(testArgv, timeoutArgv);
  const got = withoutTimeout(argv, timeoutArgv);
  if (!test.length || !got.length) return false;
  if (got[0] !== test[0]) return false;
  if (!sameSet(flagsOf(test), flagsOf(got))) return false;
  const want = new Set((targets ?? []).map((t) => String(t)));
  if (!want.size) return false;
  const testPos = positional(test);
  const obPos = positional(got);
  let shared = 0;
  while (shared < testPos.length && shared < obPos.length && testPos[shared] === obPos[shared]) shared++;
  if (shared < testPos.length - 1) return false;
  const rest = obPos.slice(shared);
  if (!rest.length || !rest.every((w) => want.has(w))) return false;
  return true;
}

function xmlAttrs(raw) {
  const out = {};
  const re = /([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g;
  for (let m; (m = re.exec(String(raw))); ) out[m[1]] = m[2];
  return out;
}

const decodeXml = (s) => String(s ?? "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function junitMessage(body) {
  const m = /<(?:failure|error)\b([^>]*)(?:\/>|>([\s\S]*?)<\/(?:failure|error)>)/.exec(body);
  if (!m) return "";
  const attr = xmlAttrs(m[1]).message;
  const text = String(m[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return decodeXml(attr || text).slice(0, 400);
}

function junitStatus(body) {
  if (/<(?:failure|error)\b/.test(body)) return "failed";
  if (/<skipped\b/.test(body)) return "missing";
  return "passed";
}

export function parseJunit(xml) {
  const tests = [];
  const re = /<testcase\b([^>]*)\/>|<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
  for (let m; (m = re.exec(String(xml))); ) {
    const attrs = xmlAttrs(m[1] ?? m[2]);
    const body = m[3] ?? "";
    const name = attrs.name ?? "";
    const full = attrs.classname && name ? `${attrs.classname}.${name}` : name || attrs.classname || "";
    if (!full && !attrs.file) continue;
    tests.push({ name: full || name, file: toSlash(attrs.file ?? ""), status: junitStatus(body), message: junitMessage(body) });
  }
  return tests;
}

function normStatus(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (PASS.has(s)) return "passed";
  if (FAIL.has(s)) return "failed";
  if (MISS.has(s)) return "missing";
  return "missing";
}

function testRecord(name, value, file = "") {
  if (value && typeof value === "object") {
    return { name: String(name), file: toSlash(value.file ?? file), status: normStatus(value.status ?? value.outcome ?? value.state ?? value.result), message: String(value.message ?? "").slice(0, 400) };
  }
  return { name: String(name), file: toSlash(file), status: normStatus(value), message: "" };
}

function asTests(value) {
  if (Array.isArray(value)) return value.filter((t) => t && (t.name || t.file)).map((t) => testRecord(t.name ?? t.file, t, t.file));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([name, v]) => testRecord(name, v));
}

export function parseJsonReport(text) {
  const data = JSON.parse(text);
  if (Array.isArray(data)) return asTests(data);
  if (data && typeof data === "object" && (Array.isArray(data.tests) || (data.tests && typeof data.tests === "object"))) return asTests(data.tests);
  return asTests(data);
}

// {present, tests, error?}. Absent, unreadable or too big is present false: the obligation runs.
export function readSuiteReport(root, spec) {
  if (!spec || typeof spec.path !== "string" || (spec.format !== "junit" && spec.format !== "json")) return { present: false, tests: [], error: "not declared" };
  let abs;
  try {
    abs = resolveInside(root, spec.path);
  } catch (e) {
    return { present: false, tests: [], error: e.message };
  }
  if (!fs.existsSync(abs)) return { present: false, tests: [] };
  const size = fs.statSync(abs).size;
  if (size > REPORT_MAX_BYTES) return { present: false, tests: [], error: "larger than 32 MB" };
  try {
    const text = readText(abs);
    const tests = spec.format === "junit" ? parseJunit(text) : parseJsonReport(text);
    return { present: true, tests };
  } catch (e) {
    return { present: false, tests: [], error: e.message };
  }
}

function matchesTarget(target, test) {
  const t = toSlash(String(target)).replace(/^\.\//, "");
  if (!t) return false;
  const name = test.name ?? "";
  const file = toSlash(test.file ?? "");
  if (name === t || file === t) return true;
  if (name.startsWith(`${t}.`) || name.startsWith(`${t}/`)) return true;
  if (file && (file === t || file.endsWith(`/${t}`) || t.endsWith(`/${file}`))) return true;
  return false;
}

// covered only when every target has a report entry. An entry that failed or is skipped/missing fails the obligation.
// A target with no entry is not covered: the caller runs the obligation.
export function reportVerdict(targets, tests) {
  const want = (targets ?? []).map((t) => String(t)).filter(Boolean);
  if (!want.length || !Array.isArray(tests) || !tests.length) return { covered: false, matched: [], missing: want };
  const matched = [];
  const missing = [];
  for (const t of want) {
    const hits = tests.filter((test) => matchesTarget(t, test));
    if (!hits.length) missing.push(t);
    else matched.push(...hits);
  }
  if (missing.length || !matched.length) return { covered: false, matched, missing };
  const outcome = matched.some((m) => m.status !== "passed") ? "failed" : "passed";
  return { covered: true, outcome, matched, missing, targets: want };
}

function metricName(source, groups) {
  if (groups?.name) return String(groups.name);
  const m = /^([A-Za-z_][\w.-]*)/.exec(source);
  return m ? m[1] : "metric";
}

// Numbers an obligation printed. No match is nothing, never a failure. `value` is a number when the capture is one.
export function metricHits(text, patterns) {
  const src = String(text ?? "");
  const out = [];
  for (const pattern of patterns ?? []) {
    if (typeof pattern !== "string" || !pattern) continue;
    let re;
    try {
      re = new RegExp(pattern, "g");
    } catch {
      continue;
    }
    for (const m of src.matchAll(re)) {
      const raw = m.groups?.value ?? m[1];
      if (raw === undefined) continue;
      const num = /^-?\d+(?:\.\d+)?$/.test(String(raw)) ? Number(raw) : null;
      out.push({ name: metricName(re.source, m.groups), value: num, raw: String(raw) });
    }
  }
  return out;
}

// Move a regression failure onto the wave plans whose diff touched its files. attribute() itself is unchanged.
export function placeRegressions(failures, attribution, steps, unownedTests) {
  const regOf = new Map(steps.filter((s) => s.regression).map((s) => [s.name, s.regression]));
  if (!regOf.size) return unownedTests;
  const drop = new Set();
  for (const f of failures) {
    const reg = regOf.get(f.step);
    // A step the gate did not run (an earlier adapter gate failed) is not a regression of this wave.
    if (!reg || f.outcome === "unavailable") continue;
    drop.add(f);
    f.regression = reg;
    if (reg.plans?.length) f.plan = reg.plans[0];
  }
  if (!drop.size) return unownedTests;
  const { byPlan, unplaced, blockedBy } = attribution;
  for (const id of Object.keys(byPlan)) {
    byPlan[id] = byPlan[id].filter((f) => !drop.has(f));
    if (!byPlan[id].length) delete byPlan[id];
  }
  for (let i = unplaced.length - 1; i >= 0; i--) if (drop.has(unplaced[i])) unplaced.splice(i, 1);
  for (const f of drop) for (const id of regOf.get(f.step).plans ?? []) (byPlan[id] ??= []).push(f);
  for (const reg of regOf.values()) delete blockedBy[reg.of];
  return unownedTests.filter((t) => failures.some((f) => !drop.has(f) && (f.tests ?? []).includes(t.file)));
}
