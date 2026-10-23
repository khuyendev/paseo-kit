// Kit feedback 87 (RE): a run journal for the fake host, as the engine keeps it (FLOW-15, FLOW-17). A call's key is its prompt and the
// options that change what the agent does (journal.mjs CACHE_KEY_OPTIONS, the model standing for the resolved identity); a finished
// call is kept under `key#occurrence`. A resumed run (same run id) gets a kept call's reply back without calling the agent, as
// `ph workflow --resume` does; a reply of null or a killed call is never kept.
import crypto from "node:crypto";
import { Killed, runScript } from "../gsd-flows/host.mjs";
import { PHASE_DIR } from "../gsd-flows/world.mjs";

const KEY_OPTIONS = ["schema", "agentType", "effort", "isolation", "readOnly", "cwd", "worktreeSeed", "model"];
const keyOf = (prompt, o) => crypto.createHash("sha256").update(JSON.stringify({ prompt, ...Object.fromEntries(KEY_OPTIONS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) })).digest("hex");
const isNull = (v) => v === null || v === undefined || Object.hasOwn(Object(v), "__null");

export function journal() {
  const kept = new Map();
  // One run against the journal: `replay` serves kept calls; every call is listed as {label, hit}.
  const wrap = (responder, replay) => {
    const occ = new Map();
    const calls = [];
    const fn = async (prompt, o, n, all) => {
      const key = keyOf(prompt, o);
      const k = `${key}#${occ.get(key) ?? 0}`;
      occ.set(key, (occ.get(key) ?? 0) + 1);
      if (replay && kept.has(k)) {
        calls.push({ label: o.label, hit: true });
        return structuredClone(kept.get(k));
      }
      calls.push({ label: o.label, hit: false });
      const v = await responder(prompt, o, n, all);
      if (!isNull(v)) kept.set(k, structuredClone(v));
      return v;
    };
    return { fn, calls };
  };
  return { kept, wrap };
}

// A gsd-plan run against the journal: {result, calls (with hit), error} — `error` when the run was killed.
export async function planRun(w, j, responder, { args = {}, replay = false, runId, script = "gsd-plan" } = {}) {
  const { fn, calls } = j.wrap(responder, replay);
  try {
    const r = await runScript(script, { root: w.root, args: { phaseDir: PHASE_DIR, ...args }, gsd: w.gsd, agent: fn, ...(runId ? { runId } : {}) });
    return { result: r.result, logs: r.logs, calls };
  } catch (error) {
    if (!(error instanceof Killed)) throw error;
    return { error, calls };
  }
}

// Dies the first time it is reached.
export function dieOnce(what) {
  let armed = true;
  return () => {
    if (armed) {
      armed = false;
      throw new Killed(`killed at ${what}`);
    }
  };
}
