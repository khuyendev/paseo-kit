// THIN.md stage 2 (TE, kit feedback 87): the runtime of concurrent steps is engine globals, one implementation for every
// composition: pool (bounded, results in order), slots (a gate of n), serialize (one at a time, a failure does not stop the next)
// and turnLock (shared holders together, an exclusive one alone, first come first served).
import { test } from "node:test";
import assert from "node:assert/strict";
import { newScript, runEngine, stubRoot } from "./engine.mjs";

const run = async (body) => (await runEngine(stubRoot(), newScript(body))).result;

test("TE pool and slots are engine globals: at most n at once, results in item order", async () => {
  const r = await run(`
let running = 0;
let most = 0;
const work = async (x) => { running++; most = Math.max(most, running); for (let k = 0; k < 6 - x; k++) await null; running--; return x * 10; };
const out = await pool([1, 2, 3, 4, 5], 2, (x, i) => work(x).then((v) => v + i));
const poolMost = most;
most = 0;
const gate = slots(3);
const gated = await parallel([1, 2, 3, 4, 5, 6].map((x) => () => gate(() => work(x % 5 + 1))));
return { out, poolMost, slotsMost: most, gated };
`);
  assert.deepEqual(r, { out: [10, 21, 32, 43, 54], poolMost: 2, slotsMost: 3, gated: [20, 30, 40, 50, 10, 20] });
  // A script's own definition still wins over the engine's, so an old composition that carries its pool keeps working.
  assert.deepEqual(await run('async function pool(items) { return items.map(() => "mine"); }\nreturn await pool([1, 2], 1, async () => "kit");'), ["mine", "mine"]);
});

test("TE serialize runs calls one at a time in order, and a failed call does not stop the next", async () => {
  const r = await run(`
const turn = serialize();
const seen = [];
const a = turn(async () => { await null; await null; seen.push("a"); throw new Error("a failed"); });
const b = turn(async () => { seen.push("b"); return "b"; });
let failed = null;
try { await a; } catch (e) { failed = e.message; }
return { b: await b, seen, failed };
`);
  assert.deepEqual(r, { b: "b", seen: ["a", "b"], failed: "a failed" });
});

test("TE turnLock: shared holders run together, an exclusive one alone, and a waiting request is served before later ones", async () => {
  const r = await run(`
const lock = turnLock();
const trace = [];
const job = (kind, name, steps) => lock[kind](async () => { trace.push("+" + name); for (let k = 0; k < steps; k++) await null; trace.push("-" + name); return name; });
const names = await Promise.all([job("shared", "a", 3), job("shared", "b", 3), job("exclusive", "x", 1), job("shared", "c", 1), job("exclusive", "y", 1)]);
return { names, trace };
`);
  assert.deepEqual(r.names, ["a", "b", "x", "c", "y"]);
  assert.deepEqual(r.trace, ["+a", "+b", "-a", "-b", "+x", "-x", "+c", "-c", "+y", "-y"]);
});
