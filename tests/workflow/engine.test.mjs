import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runWorkflow, MAX_ITEMS_PER_CALL } from "../../ship/.agents/harness/workflow/engine.mjs";
import { cacheKey, loadJournalCache, readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { fakeHost, meta } from "./helpers.mjs";

function engine(body, { host = fakeHost(), limits = {}, cache, journalPath, args, resolveChild, extraSpent, metaExtra = "" } = {}) {
  const out = [];
  const p = runWorkflow({
    source: `${meta("t", metaExtra)}${body}`, scriptPath: "C:/p/wf.js", args, runId: "wf_test", root: process.cwd(), env: process.env,
    limits: { maxConcurrent: 4, maxAgents: 100, budgetTotal: null, shellTimeoutS: 30, ...limits }, journalPath, cache, out: (l) => out.push(l),
    resolveChild: resolveChild ?? (() => { throw new Error("no child"); }), extraSpent, host,
  });
  return { p, out, host };
}

const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test("FLOW-03 a null runner result is null in the script; a runner throw is null with runner error", async () => {
  const host = fakeHost({ runner: (s) => (s.prompt === "boom" ? Promise.reject(new Error("kaput")) : { status: "null", reason: "finished without a reply", tokens: 0 }) });
  const { p, out } = engine(`return [await agent("a"), await agent("boom")];`, { host });
  assert.deepEqual((await p).result, [null, null]);
  assert.ok(out.some((l) => /^agent done #1 agent null \(finished without a reply\)/.test(l)));
  assert.ok(out.some((l) => /^agent done #2 agent null \(runner error: kaput\)/.test(l)));
});

test("FLOW-03 configuration errors throw directly but are null items inside parallel", async () => {
  await assert.rejects(engine(`await agent("x", { bogus: 1 });`).p, /unknown option 'bogus'/);
  const { p, out } = engine(`return await parallel([() => agent("x", { bogus: 1 }), () => agent("y")]);`);
  assert.deepEqual((await p).result, [null, "r:y"]);
  assert.ok(out.includes("log warning: parallel item 0 -> null: agent(): unknown option 'bogus'"));
  await assert.rejects(engine(`await agent("x", { isolation: "copy" });`).p, /isolation must be 'worktree'/);
});

test("FLOW-03 identity failures (unknown agent type) are the call's null reason", async () => {
  const host = fakeHost({ identify: ({ opts }) => (opts.agentType === "nope" ? { error: "agent type 'nope' not found: x" } : { roleHash: "", model: "p/m", effort: null, provider: "p" }) });
  const { p, out } = engine(`return await agent("x", { agentType: "nope" });`, { host });
  assert.equal((await p).result, null);
  assert.equal(host.calls.runner.length, 0);
  assert.ok(out.some((l) => l.startsWith("agent done #1 agent null (agent type 'nope' not found: x)")));
});

test("FLOW-04 options: exactly the allowed set, label defaults to the phase", async () => {
  const { p, host } = engine(`phase("Draft"); await agent("a"); await agent("b", { label: "L", phase: "P" }); await agent("c", { phase: "Q" });`, { metaExtra: `, phases: [{ title: "Draft" }]` });
  await p;
  assert.deepEqual(host.calls.runner.map((s) => [s.label, s.phase]), [["Draft", "Draft"], ["L", "P"], ["Q", "Q"]]);
  for (const k of ["label", "phase", "schema", "agentType", "role", "model", "effort", "isolation", "readOnly", "cwd", "keep", "session"]) {
    const value = k === "schema" ? { type: "object", properties: {} } : k === "isolation" ? "worktree" : k === "readOnly" || k === "keep" ? true : "v";
    await assert.doesNotReject(engine(`await agent("x", ${JSON.stringify({ [k]: value })});`).p, k);
  }
});

test("FLOW-05 pipeline: no barrier between items, a throwing stage nulls only its item", async () => {
  const gates = { A: deferred(), B: deferred() };
  const events = [];
  const host = fakeHost({
    runner: async (s) => {
      events.push(`start ${s.prompt}`);
      if (s.prompt === "1:B") await gates.B.promise;
      if (s.prompt === "1:A") gates.A.resolve();
      events.push(`end ${s.prompt}`);
      return { status: "ok", result: s.prompt, tokens: 0 };
    },
  });
  const { p, out } = engine(`return await pipeline(["A", "B", "C"], (x) => agent("1:" + x), (prev, item) => { if (item === "C") throw new Error("bad"); return agent("2:" + item); });`, { host });
  await gates.A.promise;
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(events.includes("start 2:A") && !events.includes("end 1:B"), events.join(", "));
  gates.B.resolve();
  assert.deepEqual((await p).result, ["2:A", "2:B", null]);
  assert.ok(out.includes("log warning: pipeline item 2 -> null: bad"));
  await assert.rejects(engine(`await pipeline("x", () => 1);`).p, /pipeline\(\) takes an array/);
  await assert.rejects(engine(`await pipeline(new Array(${MAX_ITEMS_PER_CALL + 1}).fill(0), (x) => x);`).p, /at most 4096/);
});

test("FLOW-06 parallel: one throwing thunk gives null, never rejects", async () => {
  const { p, out } = engine(`return await parallel([async () => "a", async () => { throw new Error("no"); }, async () => "c"]);`);
  assert.deepEqual((await p).result, ["a", null, "c"]);
  assert.ok(out.includes("log warning: parallel item 1 -> null: no"));
  await assert.rejects(engine(`await parallel(1);`).p, { name: "TypeError" });
  await assert.rejects(engine(`await parallel(new Array(4097).fill(() => 1));`).p, /at most 4096/);
});

test("FLOW-07 phase prints, unknown phase warns, log prints", async () => {
  const { p, out } = engine(`phase("A"); phase("Z"); log("a");`, { metaExtra: `, phases: [{ title: "A" }]` });
  await p;
  assert.deepEqual(out, ["phase A", "phase Z", 'log warning: phase "Z" has no entry in meta.phases', "log a"]);
});

test("FLOW-08 args verbatim, undefined without; nested workflow gets cloned args", async () => {
  assert.deepEqual((await engine(`return args;`, { args: { a: 1 } }).p).result, { a: 1 });
  assert.equal((await engine(`return typeof args;`).p).result, "undefined");
  const child = { source: `${meta("child")}args.b = 2; return args;`, scriptPath: "C:/p/child.js" };
  const r = await engine(`const a = { b: 1 }; const c = await workflow("child", a); return [a.b, c.b];`, { resolveChild: () => child }).p;
  assert.deepEqual(r.result, [1, 2]);
});

test("FLOW-09 budget 5, 10-token calls, concurrency 1: exactly one runner call", async () => {
  const host = fakeHost({ runner: () => ({ status: "ok", result: "x", tokens: 10 }) });
  const { p } = engine(`return await parallel([1, 2, 3, 4, 5].map((i) => () => agent("p" + i)));`, { host, limits: { maxConcurrent: 1, budgetTotal: 5 } });
  assert.deepEqual((await p).result, ["x", null, null, null, null]);
  assert.equal(host.calls.runner.length, 1);
  const b = await engine(`return [budget.total, budget.spent(), budget.remaining()];`, { limits: { budgetTotal: 100 }, extraSpent: () => 7 }).p;
  assert.deepEqual(b.result, [100, 7, 93]);
  assert.deepEqual((await engine(`return [budget.total, budget.remaining() === Infinity];`).p).result, [null, true]);
});

test("FLOW-10 nested workflow: one level, shares counters, logs the path", async () => {
  const children = {
    child: { source: `${meta("child")}await agent("c1"); return "done";`, scriptPath: "C:/p/.agents/workflows/child.js" },
    deep: { source: `${meta("deep")}return await workflow("child");`, scriptPath: "C:/p/.agents/workflows/deep.js" },
  };
  const { p, out } = engine(`await agent("p1"); return await workflow("child");`, { resolveChild: (ref) => children[ref] });
  const r = await p;
  assert.equal(r.result, "done");
  assert.equal(r.stats.started, 2);
  assert.ok(out.includes("log nested workflow C:/p/.agents/workflows/child.js"));
  await assert.rejects(engine(`return await workflow("deep");`, { resolveChild: (ref) => children[ref] }).p, /nesting is one level only/);
});

test("FLOW-11 shell: string and argv forms, exit codes, input, journal record", async () => {
  const dir = makeTempDir();
  const journalPath = path.join(dir, "journal.jsonl");
  const node = JSON.stringify(process.execPath);
  const { p, out } = engine(`
    const a = await shell("exit 3");
    const b = await shell('echo "a b" && echo c');
    const c = await shell([${node}, "-e", "process.exit(4)"]);
    const d = await shell([${node}, "-e", "console.log(process.argv[1])", "a;b"]);
    const e = await shell([${node}, "-e", "process.stdin.on('data', (x) => process.stdout.write(String(x).toUpperCase()))"], { input: "x" });
    const f = await shell("definitely-not-a-command-xyz");
    const g = await shell(["C:/no/such/file.exe"]);
    return [a.code, b.stdout.replace(/\\r/g, ""), c.code, d.stdout.trim(), e.stdout, f.code !== 0 && f.code !== -1, g.code, g.stderr.length > 0];
  `, { journalPath });
  const r = await p;
  assert.deepEqual(r.result, [3, process.platform === "win32" ? '"a b" \nc\n' : "a b\nc\n", 4, "a;b", "X", true, -1, true]);
  assert.ok(out.includes("shell start #1 exit 3") && out.some((l) => /^shell done #1 code=3 [\d.]+s$/.test(l)));
  assert.equal(readJournal(journalPath).filter((e) => e.kind === "shell").length, 7);
});

test("FLOW-11 shell timeout kills the process tree within the limit", async () => {
  const node = JSON.stringify(process.execPath);
  const script = "const c=require('child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});console.log(c.pid);setTimeout(()=>{},60000)";
  const t0 = Date.now();
  const r = await engine(`return await shell([${node}, "-e", ${JSON.stringify(script)}], { timeoutS: 1 });`).p;
  assert.ok(Date.now() - t0 < 4000, `took ${Date.now() - t0} ms`);
  assert.equal(r.result.code, -1);
  assert.match(r.result.stderr, /\[timed out after 1 s\]$/);
  const pid = Number(r.result.stdout.trim());
  await new Promise((res) => setTimeout(res, 300));
  assert.throws(() => process.kill(pid, 0), "grandchild still alive");
});

test("FLOW-43 FLOW-09 maxAgents below maxConcurrent: four parallel calls start exactly one agent", async () => {
  const host = fakeHost();
  const r = await engine(`return await parallel([1, 2, 3, 4].map((i) => () => agent("p" + i)));`, { host, limits: { maxConcurrent: 4, maxAgents: 1 } }).p;
  assert.equal(host.calls.runner.length, 1);
  assert.equal(r.stats.started, 1);
  assert.equal(r.result.filter((x) => x === null).length, 3);
});

test("FLOW-09 FLOW-14 spend that grows while a call waits for admission stops it before it starts", async () => {
  const gate = deferred();
  let extra = 0;
  const host = fakeHost({ admit: () => gate.promise.then(() => ({ release() {} })) });
  const { p, out } = engine(`try { await agent("a"); return "ran"; } catch (e) { return e.message; }`, { host, limits: { budgetTotal: 10 }, extraSpent: () => extra });
  await new Promise((r) => setTimeout(r, 10));
  extra = 10;
  gate.resolve();
  assert.equal((await p).result, "budget exhausted: spent 10 of 10 tokens");
  assert.equal(host.calls.runner.length, 0);
  assert.ok(!out.some((l) => l.startsWith("agent done")));
});

test("FLOW-12 FLOW-47 parallel calls with one session key run one after another", async () => {
  let running = 0;
  let overlap = false;
  const host = fakeHost({
    runner: async (s) => {
      if (s.opts.session && ++running > 1) overlap = true;
      await new Promise((r) => setTimeout(r, 10));
      if (s.opts.session) running--;
      return { status: "ok", result: s.prompt, agentId: "a", tokens: 0 };
    },
  });
  const r = await engine(`return await parallel([() => agent("a", { session: "s" }), () => agent("b", { session: "s" }), () => agent("c")]);`, { host }).p;
  assert.deepEqual(r.result, ["a", "b", "c"]);
  assert.equal(overlap, false);
  assert.deepEqual(host.calls.runner.filter((s) => s.opts.session).map((s) => s.prompt), ["a", "b"]);
});
