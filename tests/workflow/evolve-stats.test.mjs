import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { METRICS_REL, nullCause, readLedger, runRecord } from "../../ship/.agents/harness/workflow/metrics.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { meta, setup } from "./helpers.mjs";

function fixtureRun(s, id, { status = "done", startedAt, journal = [], result, name = "wf" }) {
  const dir = s.project.path(`_workspace/_runs/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: id, status, startedAt, endedAt: startedAt.replace(":00.000Z", ":40.000Z"), name }));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), journal.map((e) => `${JSON.stringify(e)}\n`).join(""));
  if (result !== undefined) fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result));
}

const call = (fields) => ({ n: 1, label: "verify", agentType: "gsd-verifier", roleHash: "aaaaaaaaaaaaaaaaaaaa", model: "circle/m", effort: "high", status: "ok", agentId: "a1", tokens: 10, usage: { input: 100, cachedInput: 50, output: 10, costUsd: 0.01 }, duration_s: 20, ...fields });

test("EVOL-01 null reasons sort into agent, infra and other causes", () => {
  assert.equal(nullCause("reply did not match the schema after 3 replies: #1 x"), "schema");
  assert.equal(nullCause("no reply within 600 s"), "timeout");
  assert.equal(nullCause("finished without a reply"), "empty");
  for (const r of ["daemon connection lost earlier in this run (x); resume the run", "runner error: boom", "live agent cap reached (3 of 3); end sessions", "agent error: overloaded", "agent is waiting for a permission: Bash"]) assert.equal(nullCause(r), "infra", r);
  assert.equal(nullCause("tier pro is not configured"), "other");
  assert.equal(nullCause(null), "other");
});

test("EVOL-02 a run record groups ran calls per agent version; cached calls do not count; result status and gaps are the outcome", () => {
  const info = { name: "gsd-verify", status: "done", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:01:40.000Z" };
  const journal = [
    { n: 1, kind: "agent", status: "start" },
    call({}),
    call({ n: 2, status: "null", reason: "no reply within 60 s", usage: null, tokens: 0, agentId: null, duration_s: 60 }),
    call({ n: 3, status: "cached", tokens: 0, usage: null }),
    { n: 4, label: "fix-07-02:1", status: "ok", agentId: "a4", model: "circle/m", tokens: 3, usage: null, duration_s: 5 },
    { n: 1, kind: "shell", cmd: "npm test", code: 0 },
  ];
  const r = runRecord("wf_1", info, journal, { status: "gaps_found", gaps: [{}, {}] });
  assert.equal(r.workflow, "gsd-verify");
  assert.equal(r.wallS, 100);
  assert.deepEqual(r.outcome, { status: "gaps_found", gaps: 2 });
  assert.equal(r.groups.length, 2);
  const [v, fix] = r.groups;
  assert.deepEqual(v, { agent: "gsd-verifier", roleHash: "aaaaaaaaaaaa", model: "circle/m", effort: "high", calls: 2, ok: 1, nulls: 1, causes: { timeout: 1 }, secs: [20, 60], input: 100, cachedInput: 50, output: 10, costUsd: 0.01 });
  // An entry without agentType (journals before this change) is keyed by its label's role part without numbered
  // suffixes; an unpriced agent call leaves the cost unknown.
  assert.equal(fix.agent, "label:fix");
  assert.equal(fix.output, 3);
  assert.equal(fix.roleHash, null);
  assert.equal(fix.costUsd, null);
  assert.equal(runRecord("wf_2", info, [], "text").outcome, null);
});

test("EVOL-03 ph evolve-stats --import reads ended runs once, splits agent versions and marks few runs", async () => {
  const s = setup();
  fixtureRun(s, "wf_a", { startedAt: "2026-10-18T10:00:00.000Z", journal: [call({})], result: { status: "passed" }, name: "gsd-verify" });
  fixtureRun(s, "wf_b", { startedAt: "2026-10-19T10:00:00.000Z", journal: [call({ roleHash: "bbbbbbbbbbbbbbbb", status: "null", reason: "reply did not match the schema after 2 replies: x" })], result: { status: "gaps_found", gaps: [{}] }, name: "gsd-verify" });
  fixtureRun(s, "wf_c", { status: "running", startedAt: "2026-10-20T10:00:00.000Z", journal: [call({})] });
  const r = await s.ph(["evolve-stats", "--import"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.out, [
    "imported 2 runs (1 skipped: already recorded, running or without run.json)",
    "gsd-verifier aaaaaaaaaaaa circle/m high: runs 1, calls 1, ok 1, null 0; median 20 s; tokens/call in 100 cached 50 out 10; cost $0.01/call; 2026-10-18..2026-10-18; run results passed 1 (few runs: < 5, not a measurement)",
    "gsd-verifier bbbbbbbbbbbb circle/m high: runs 1, calls 1, ok 0, null 1 (agent 1: schema 1; infra 0; other 0); median 20 s; tokens/call in 100 cached 50 out 10; cost $0.01/call; 2026-10-19..2026-10-19; run results gaps_found 1 (few runs: < 5, not a measurement)",
    "workflow gsd-verify: runs 2 (done 2); results passed 1, gaps_found 1, gaps 1; median wall 40 s; cost $0.01/run",
    `evolve-stats: 2 runs from ${METRICS_REL}`,
  ]);
  const again = await s.ph(["evolve-stats", "--import"]);
  assert.equal(again.out[0], "imported 0 runs (3 skipped: already recorded, running or without run.json)");
  assert.equal(readLedger(s.project.root).records.length, 2);
  const one = await s.ph(["evolve-stats", "--agent", "gsd-verifier", "--since", "2026-10-19"]);
  assert.equal(one.out.length, 2);
  assert.match(one.out[0], /^gsd-verifier bbbbbbbbbbbb /);
  assert.equal(one.out[1], `evolve-stats: 1 runs from ${METRICS_REL}`);
});

test("EVOL-03 bad arguments exit 1; an empty or damaged ledger is reported, not fatal", async () => {
  const s = setup();
  assert.equal((await s.ph(["evolve-stats", "--since", "yesterday"])).code, 1);
  assert.equal((await s.ph(["evolve-stats", "--runs-dir", "x"])).code, 1);
  assert.equal((await s.ph(["evolve-stats", "extra"])).code, 1);
  assert.deepEqual((await s.ph(["evolve-stats"])).out, [`evolve-stats: 0 runs from ${METRICS_REL}`]);
  s.project.write(METRICS_REL, "not json\n{\"v\":99}\n");
  assert.deepEqual((await s.ph(["evolve-stats"])).out, [`evolve-stats: 0 runs from ${METRICS_REL}, 2 unreadable lines skipped`]);
});

test("EVOL-05 the evolve overlay and the ph skill name the ledger, the command and the measurement rules", () => {
  const read = (rel) => fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", rel), "utf8");
  const overlay = read("harness/references/kit-adapter.md");
  for (const s of [METRICS_REL, "ph evolve-stats --import", "at least 5 runs", "measured: <agent> <old hash> -> <new hash>", "not measured (<why>)", "Sort every failure by cause"]) assert.ok(overlay.includes(s), s);
  const ph = read("ph/SKILL.md");
  for (const s of [METRICS_REL, "ph evolve-stats"]) assert.ok(ph.includes(s), s);
});

test("EVOL-04 an ended ph workflow journals the agent version and appends its run to the ledger", async () => {
  const s = setup({ files: { ".agents/agents/rev.md": "---\nname: reviewer\ntools: Read, Grep\n---\nYou review things.\n" } });
  s.project.write("wf.js", `${meta("flow")}const a = await agent("x", { agentType: "rev" }); return { status: "passed", a };`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  const id = fs.readdirSync(s.project.path("_workspace/_runs"))[0];
  const done = readJournal(s.project.path(`_workspace/_runs/${id}/journal.jsonl`)).find((e) => e.status === "ok");
  assert.equal(done.agentType, "rev");
  assert.match(done.roleHash, /^[0-9a-f]{16,}$/);
  assert.ok("effort" in done && "role" in done);
  s.project.write("bad.js", `${meta("bad")}throw new Error("nope");`);
  assert.equal((await s.ph(["workflow", "--script", "bad.js"])).code, 2);
  const { records } = readLedger(s.project.root);
  assert.deepEqual(records.map((x) => [x.workflow, x.status, x.outcome?.status ?? null]), [["flow", "done", "passed"], ["bad", "failed", null]]);
  assert.equal(records[0].runId, id);
  assert.equal(records[0].groups[0].agent, "rev");
  assert.equal(records[0].groups[0].roleHash, done.roleHash.slice(0, 12));
});
