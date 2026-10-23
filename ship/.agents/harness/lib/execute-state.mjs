// The record of gsd-execute's resume state (kit feedback 83 F1/F2, 87): `<phaseDir>/execute-progress.json`, its schema check and the
// migration of a record an older kit wrote. Written only by workflows/lib/flow-state.mjs (the state-* flow verbs); read here by
// that writer and by the answer verbs (ph gsd shared clear, request clear), which never write it.
import { readJsonIf } from "./io.mjs";

export const STATE_FILE = "execute-progress.json";
export const STATE_VERSION = 2;
export const PLAN_STAGES = Object.freeze(["dispatched", "executed", "transferred", "committed", "tracked", "halted"]);
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

export function fresh() {
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

/** The typed state of one execute-progress.json (a fresh state when there is none); never writes. */
export function readStateFile(file) {
  const data = readJsonIf(file, null);
  if (data === null) return { state: fresh(), exists: false, migrated: false };
  check(data, file);
  return { state: normalize(data), exists: true, migrated: data.version !== STATE_VERSION };
}

