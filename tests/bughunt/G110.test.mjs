// G110 (bug hunt 2026-10-23): a debug turn runs only after its budget is reserved, a budget that cannot be saved stops the
// session, and an open reservation (a turn whose run was interrupted) counts as spent on resume (GSDF-67).
import assert from "node:assert/strict";
import test from "node:test";
import { debugBudget, debugCreate, debugStatus } from "../../ship/.agents/harness/gsd/debug.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

// The real verbs run in-process against the temp project; the host passes [slug] and the stdin JSON.
function debugWorld({ max = 3 } = {}) {
  const w = makeWorld({ overlay: { gsd: { debug: { max_turns: max, minutes: 120 } } } });
  const g = { codeRoot: w.root };
  const slug = debugCreate(g, { signature: { kind: "test", key: "login", label: "login-fails" }, symptoms: { expected: "ok", actual: "fails", errors: "E", reproduction: "r", started: "s" }, owns: ["Path:src/login/"] }).json.slug;
  w.gsd.on("debug status", (argv) => debugStatus(g, argv[0]));
  w.gsd.on("debug budget", (argv, input) => debugBudget(g, argv[0], JSON.parse(input)));
  return { w, g, slug };
}
const debug = (w, slug, agent) => runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug }, agent });
// A debugger that never finishes: a sixth turn throws, so an unbounded loop fails the test instead of hanging it.
function continueTurns() {
  let n = 0;
  return () => {
    if (++n > 5) throw new Error("the debugger ran more than 5 turns");
    return { status: "continue" };
  };
}

test("G110 a debug budget that cannot be saved stops the session before the next debugger turn", async () => {
  const { w, g, slug } = debugWorld();
  w.gsd.on("debug budget", (argv, input) => {
    const d = JSON.parse(input);
    if (d.turns !== undefined) return { code: 1, json: { status: "error", error: "EPERM: rename" } };
    return debugBudget(g, argv[0], d);
  });
  const r = await debug(w, slug, continueTurns());
  assert.deepEqual([r.result.status, r.result.type, r.calls.length], ["needs-owner", "budget-not-saved", 1]);
  assert.match(r.result.reason, /EPERM: rename/);
});

test("G110 a budget reservation that cannot be saved stops before any debugger turn starts", async () => {
  const { w, g, slug } = debugWorld();
  w.gsd.on("debug budget", () => ({ code: 1, json: { status: "error", error: "EPERM: rename" } }));
  const r = await debug(w, slug, continueTurns());
  assert.deepEqual([r.result.status, r.result.type, r.calls.length], ["needs-owner", "budget-not-saved", 0]);
  assert.equal(debugStatus(g, slug).json.frontmatter.budget_used?.turns ?? 0, 0);
});

test("G110 each debugger turn is reserved before it starts and charged after it returns", async () => {
  const { w, slug } = debugWorld({ max: 1 });
  const next = continueTurns();
  const before = [];
  const r = await debug(w, slug, () => {
    before.push(w.gsd.calls.at(-1));
    return next();
  });
  assert.equal(r.result.type, "budget-exhausted");
  assert.deepEqual(before.map((c) => [c.key, JSON.parse(c.input)]), [["debug budget", { reserve: 1 }]]);
  assert.deepEqual(w.gsd.callsOf("debug budget").map((c) => JSON.parse(c.input)), [{ reserve: 1 }, { turns: 1, minutes: 1 }]);
});

test("G110 an open reservation from an interrupted turn counts as spent, and the prompt keeps the charged budget", async () => {
  const { w, g, slug } = debugWorld();
  debugBudget(g, slug, { reserve: 2 });
  const r = await debug(w, slug, continueTurns());
  assert.deepEqual([r.result.type, r.calls.length], ["budget-exhausted", 1]);
  assert.match(r.calls[0].prompt, /Budget left: 3 turns, 120 minutes\./);
  const fm = debugStatus(g, slug).json.frontmatter;
  assert.deepEqual([fm.budget_used.turns, fm.budget_reserved.turns], [1, 2]);
});

test("G110 a charged turn settles its own reservation and leaves the interrupted one open", async () => {
  const { w, g, slug } = debugWorld();
  debugBudget(g, slug, { reserve: 1 });
  const r = await debug(w, slug, continueTurns());
  assert.deepEqual([r.result.type, r.calls.length], ["budget-exhausted", 2]);
  const fm = debugStatus(g, slug).json.frontmatter;
  assert.deepEqual([fm.budget_used.turns, fm.budget_reserved.turns], [2, 1]);
});
