import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { cacheKey, loadJournalCache, readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakeHost, meta } from "./helpers.mjs";

function engine(body, { host = fakeHost(), limits = {}, cache, journalPath } = {}) {
  const out = [];
  const p = runWorkflow({
    source: `${meta()}${body}`, scriptPath: "wf.js", runId: "wf_test", root: process.cwd(), env: process.env,
    limits: { maxConcurrent: 20, maxAgents: 1000, budgetTotal: null, shellTimeoutS: 30, ...limits }, journalPath, cache, out: (l) => out.push(l),
    resolveChild: () => { throw new Error("none"); }, host,
  });
  return { p, out, host };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("FLOW-14 rolling pool: 40 unequal calls under cap 20 keep 20 running until fewer remain", async () => {
  let running = 0;
  let max = 0;
  const atCompletion = [];
  let remaining = 40;
  const host = fakeHost({
    runner: async (s) => {
      running++;
      max = Math.max(max, running);
      await sleep(5 + ((s.n * 7) % 23));
      remaining--;
      atCompletion.push({ running, remaining });
      running--;
      return { status: "ok", result: "x", tokens: 0 };
    },
  });
  await engine(`await parallel(Array.from({ length: 40 }, (_, i) => () => agent("p" + i)));`, { host }).p;
  assert.equal(max, 20);
  for (const c of atCompletion) assert.equal(c.running, Math.min(20, c.remaining + 1), JSON.stringify(c));
});

test("FLOW-14 cached hits skip budget, caps and semaphore", async () => {
  const dir = makeTempDir();
  const journalPath = path.join(dir, "j1.jsonl");
  const body = `return await parallel(Array.from({ length: 10 }, (_, i) => () => agent("p" + i)));`;
  await engine(body, { journalPath }).p;
  const host = fakeHost();
  const r = await engine(body, { host, cache: loadJournalCache(journalPath), journalPath: path.join(dir, "j2.jsonl"), limits: { maxAgents: 0, budgetTotal: 0 } }).p;
  assert.equal(r.stats.cached, 10);
  assert.equal(host.calls.runner.length, 0);
  assert.equal(host.calls.admit, 0);
});

test("FLOW-15 resume with the same script is 100 % cached; an edited prompt reruns only that call", async () => {
  const dir = makeTempDir();
  const j1 = path.join(dir, "j1.jsonl");
  const body = (x) => `const a = await agent("one"); const b = await agent("${x}"); const c = await agent("one"); return [a, b, c];`;
  const first = await engine(body("two"), { journalPath: j1 }).p;
  const host = fakeHost();
  const again = await engine(body("two"), { host, cache: loadJournalCache(j1) }).p;
  assert.deepEqual(again.result, first.result);
  assert.equal(host.calls.runner.length, 0);
  assert.equal(again.stats.cached, 3);
  const host2 = fakeHost();
  const { p, out } = engine(body("TWO"), { host: host2, cache: loadJournalCache(j1) });
  await p;
  assert.deepEqual(host2.calls.runner.map((s) => s.prompt), ["TWO"]);
  assert.ok(out.includes("agent cached #1 agent") && out.includes("agent cached #3 agent"));
});

test("FLOW-15 the key covers role-text hash, resolved model and effort, not label/phase/keep/session/role", () => {
  const id = { roleHash: "h1", model: "p/m", effort: null };
  const k = cacheKey("x", { agentType: "t" }, id);
  assert.equal(cacheKey("x", { agentType: "t", label: "L", phase: "P", keep: true, session: "s", role: "planner" }, id), k);
  assert.notEqual(cacheKey("x", { agentType: "t" }, { ...id, roleHash: "h2" }), k);
  assert.notEqual(cacheKey("x", { agentType: "t" }, { ...id, model: "p/other" }), k);
  assert.notEqual(cacheKey("x", { agentType: "t" }, { ...id, effort: "high" }), k);
  assert.notEqual(cacheKey("x", { agentType: "t", schema: { type: "object", properties: {} } }, id), k);
});

test("FLOW-15 an edited definition or role effort reruns the affected calls; a new schema call elsewhere keeps the rest cached", async () => {
  const dir = makeTempDir();
  const j1 = path.join(dir, "j1.jsonl");
  const ident = (hash, effort) => ({ opts }) => ({ roleHash: opts.agentType === "x" ? hash : "", model: "p/m", effort: opts.role === "planner" ? effort : null, provider: "p" });
  const body = `await agent("a", { agentType: "x" }); await agent("b", { role: "planner" }); await agent("c");`;
  await engine(body, { host: fakeHost({ identify: ident("h1", "low") }), journalPath: j1 }).p;
  const h = fakeHost({ identify: ident("h2", "high") });
  await engine(body, { host: h, cache: loadJournalCache(j1) }).p;
  assert.deepEqual(h.calls.runner.map((s) => s.prompt), ["a", "b"]);
  const h3 = fakeHost({ identify: ident("h1", "low") });
  await engine(`await agent("z", { schema: { type: "object", properties: {} } }); ${body}`, { host: h3, cache: loadJournalCache(j1) }).p;
  assert.deepEqual(h3.calls.runner.map((s) => s.prompt), ["z"]);
});

test("FLOW-15 unparsable journal lines are skipped and only ok/cached entries load", () => {
  const dir = makeTempDir();
  const j = path.join(dir, "j.jsonl");
  fs.writeFileSync(j, ['{"n":1,"key":"k","occ":0,"status":"ok","result":"a"}', "{torn", '{"n":2,"key":"k","occ":1,"status":"null"}', '{"n":3,"kind":"shell","code":0}', ""].join("\n"));
  const cache = loadJournalCache(j);
  assert.deepEqual([...cache.keys()], ["k#0"]);
});

test("FLOW-17 journal: one start and one finish per started call, gap-free n after a budget throw", async () => {
  const dir = makeTempDir();
  const journalPath = path.join(dir, "journal.jsonl");
  const host = fakeHost({ runner: (s) => ({ status: s.prompt === "b" ? "null" : "ok", reason: "agent error: x", result: "r", agentId: `a${s.n}`, model: "p/m", tokens: 3, usage: { input: 1, cachedInput: 0, output: 3, maxContext: 1, costUsd: null, reportedCostUsd: null }, durationS: 1 }) });
  const r = await engine(`await agent("a"); await agent("b"); try { await agent("c"); } catch (e) { log(e.message); } return 1;`, { host, journalPath, limits: { budgetTotal: 6 } }).p;
  const j = readJournal(journalPath);
  assert.deepEqual(j.map((e) => `${e.n}:${e.status}`), ["1:start", "1:ok", "2:start", "2:null"]);
  assert.deepEqual(Object.keys(j[1]).sort(), ["agentId", "agentType", "duration_s", "effort", "key", "label", "model", "n", "occ", "phase", "reason", "result", "role", "roleHash", "status", "tokens", "usage"].sort());
  assert.equal(j[3].reason, "agent error: x");
  assert.equal(r.stats.started, 2);
});

test("FLOW-17 a killed runner leaves the start records of in-flight calls", async () => {
  const dir = makeTempDir();
  const journalPath = path.join(dir, "journal.jsonl");
  const host = fakeHost({ runner: () => new Promise(() => {}) });
  engine(`await parallel([() => agent("a"), () => agent("b")]);`, { host, journalPath });
  await sleep(30);
  assert.deepEqual(readJournal(journalPath).map((e) => e.status), ["start", "start"]);
});

test("FLOW-23 un-awaited agent() calls are awaited before the run ends and counted", async () => {
  const order = [];
  const host = fakeHost({ runner: async () => (await sleep(20), order.push("agent"), { status: "ok", result: "x", tokens: 0 }) });
  const { p, out } = engine(`agent("fire and forget"); return { ok: true };`, { host });
  const r = await p;
  order.push("end");
  assert.deepEqual(order, ["agent", "end"]);
  assert.deepEqual(r.result, { ok: true });
  assert.ok(out.includes("log warning: 1 agent() call(s) were not awaited by the script"));
  assert.ok(out.indexOf("log warning: 1 agent() call(s) were not awaited by the script") < out.findIndex((l) => l.startsWith("agent done")));
});

test("FLOW-43 non-default limits maxConcurrent 2 and maxAgents 3 are enforced by the engine", async () => {
  let running = 0;
  let max = 0;
  const host = fakeHost({ runner: async () => (running++, (max = Math.max(max, running)), await sleep(10), running--, { status: "ok", result: "x", tokens: 0 }) });
  const r = await engine(`return await parallel(Array.from({ length: 5 }, (_, i) => () => agent("p" + i)));`, { host, limits: { maxConcurrent: 2, maxAgents: 3 } }).p;
  assert.equal(max, 2);
  assert.equal(host.calls.runner.length, 3);
  assert.deepEqual(r.result.filter((x) => x === null).length, 2);
});

test("FLOW-43 a cached session hit calls the adoption function with the recorded agent, never the runner", async () => {
  const dir = makeTempDir();
  const j1 = path.join(dir, "j1.jsonl");
  await engine(`await agent("a", { session: "coder:a" });`, { journalPath: j1 }).p;
  const host = fakeHost();
  await engine(`await agent("a", { session: "coder:a" });`, { host, cache: loadJournalCache(j1) }).p;
  assert.deepEqual(host.calls.adopt, [{ agentId: "a1", session: "coder:a" }]);
  assert.equal(host.calls.runner.length, 0);
});

test("FLOW-43 the engine imports nothing from paseo-client", () => {
  const dir = path.join(SHIP_DIR, ".agents", "harness", "workflow");
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const target = path.resolve(path.dirname(file), m[1]);
      assert.ok(!target.includes(`${path.sep}paseo-client${path.sep}`) && !target.includes(`${path.sep}runtime${path.sep}`), `${path.basename(file)} imports ${m[1]}`);
      visit(target);
    }
  };
  visit(path.join(dir, "engine.mjs"));
});
