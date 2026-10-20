import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { createFakeClock } from "../fakes/fake-clock.mjs";
import { CALLER, meta, runOwn, setup, tick } from "./helpers.mjs";

const runDir = (s, id) => s.project.path(`_workspace/_runs/${id}`);
const journal = (s, id) => readJournal(path.join(runDir(s, id), "journal.jsonl"));
const readRun = (s, id) => JSON.parse(fs.readFileSync(path.join(runDir(s, id), "run.json"), "utf8"));
const result = (s, id) => JSON.parse(fs.readFileSync(path.join(runDir(s, id), "result.json"), "utf8"));
const created = (fake) => fake.callsOf("createAgent").map((c) => c.args[0]);
const sent = (fake) => fake.callsOf("sendAgentMessage").map((c) => c.args);
const done = (s, id) => journal(s, id).filter((e) => e.status === "ok" || e.status === "null");
const SCHEMA = { type: "object", properties: { x: { type: "integer" }, y: { type: "string" }, z: { type: "boolean" } }, required: ["x"] };

// Run ph with a manual clock, advancing virtual time until the run returns.
async function drive(s, argv, { step = 1000, max = 10_000, onStep } = {}) {
  let res = null;
  const p = runOwn(argv, s).then((r) => (res = r));
  for (let i = 0; i < max && !res; i++) {
    await s.clock.advance(step);
    await onStep?.(i);
    await tick();
  }
  await p;
  return res;
}

test("FLOW-13 a reply missing a required key gets one retry in the same agent naming the error", async () => {
  const s = setup({ responder: (a, text, { turn }) => [{ reply: turn === 1 ? '{"y":"a"}' : '{"x":1}', usage: { outputTokens: 1 } }] });
  s.project.write("wf.js", `${meta()}return await agent("give", { schema: ${JSON.stringify(SCHEMA)} });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_s"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(result(s, "wf_s"), { x: 1 });
  assert.deepEqual(created(s.fake)[0].outputSchema, SCHEMA);
  const msgs = sent(s.fake);
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0][0], s.fake.callsOf("createAgent").length && [...s.fake.agents.keys()][1]);
  assert.match(msgs[0][1], /\/x: missing required property/);
});

test("FLOW-13 three bad replies with schema_retries 2 -> null with three errors in the journal reason", async () => {
  const s = setup({ responder: () => [{ reply: '{"y":1}', usage: { outputTokens: 1 } }] });
  s.project.write("wf.js", `${meta()}return await agent("give", { schema: ${JSON.stringify(SCHEMA)} });`);
  await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_s"]);
  const [e] = done(s, "wf_s");
  assert.equal(e.status, "null");
  assert.match(e.reason, /^reply did not match the schema after 3 replies: #1 .+; #1 .+; #2 .+$/);
  assert.equal(sent(s.fake).length, 2);
});

test("FLOW-24 transport loss on call 1: later calls null at once, no further create", async () => {
  const s = setup();
  s.fake.failNext("createAgent", new Error("Transport closed"));
  s.project.write("wf.js", `${meta()}const r = []; for (let i = 0; i < 5; i++) r.push(await agent("p" + i)); return r;`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_t"]);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.out.includes("log runner lost the daemon connection (Transport closed): remaining agent() calls return null; resume the run"));
  const reasons = done(s, "wf_t").map((e) => e.reason);
  assert.equal(reasons[0], "Transport closed");
  for (const x of reasons.slice(1)) assert.equal(x, "daemon connection lost earlier in this run (Transport closed); resume the run");
  assert.equal(s.fake.callsOf("createAgent").length, 1);
});

test("FLOW-26 null reasons appear exactly in the journal and the agent done line", async () => {
  const big = "x".repeat(2000);
  const s = setup({
    overlay: { wait_timeout_s: 5, max_prompt_bytes: 1500 },
    responder: (a, text) => (text.includes("@hang@") ? [{ hang: true }] : text.includes("@err@") ? [{ error: "quota exceeded" }] : text.includes("@perm@") ? [{ permission: { name: "Bash" } }] : [{ reply: "" }]),
  });
  s.project.write("wf.js", `${meta()}for (const p of ["@empty@", "@hang@", "@err@", "@perm@", "${big}"]) await agent(p); await agent("t", { agentType: "nope" });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_r"]);
  assert.equal(r.code, 0, r.stderr);
  const reasons = done(s, "wf_r").map((e) => e.reason);
  assert.equal(reasons[0], "finished without a reply");
  assert.equal(reasons[1], "no reply within 5 s");
  assert.equal(reasons[2], "agent error: quota exceeded");
  assert.equal(reasons[3], "agent is waiting for a permission: Bash");
  assert.match(reasons[4], /^prompt is \d+ bytes > max_prompt_bytes 1500; pass a file path instead of inlining content$/);
  assert.match(reasons[5], /^agent type 'nope' not found/);
  for (const [i, reason] of reasons.entries()) assert.ok(r.out.some((l) => l.startsWith(`agent done #${i + 1} `) && l.includes(`null (${reason})`)), reason);
});

test("FLOW-26 FLOW-34 a model-time stop is the call's null reason; FLOW-35 a stuck tool is interrupted, then the retry turn's reply is the result", async () => {
  const clock = createFakeClock({ auto: false });
  const write = (status) => ({ type: "tool_call", callId: "w1", name: "Write", status, detail: { type: "write", filePath: "a.txt", content: "x" } });
  const s = setup({
    clock,
    overlay: { agent_nudge_s: 0, agent_stop_s: 60, agent_file_tool_stuck_s: 30 },
    responder: (a, text, { turn }) => (text.includes("@think@") ? [{ manual: true }] : turn === 1 ? [{ tool: write("running") }, { manual: true }] : [{ reply: "after retry" }]),
  });
  s.project.write("wf.js", `${meta()}return [await agent("stuck"), await agent("@think@")];`);
  const r = await drive(s, ["workflow", "--script", "wf.js", "--run-id", "wf_w"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(result(s, "wf_w"), ["after retry", null]);
  assert.equal(done(s, "wf_w")[1].reason, "watchdog stopped the agent after 60 s");
  assert.equal(s.fake.callsOf("cancelAgent").length, 1);
  assert.ok(sent(s.fake).some(([, t]) => t.startsWith("Harness watchdog: your Write call did not return and was interrupted.")));
  assert.ok(r.out.some((l) => /^log watchdog: agent \S{8} one Write call ran \d+ s without returning, interrupted$/.test(l)));
  const thinker = done(s, "wf_w")[1].agentId;
  assert.equal(s.fake.callsOf("archiveAgent").filter((c) => c.args[0] === thinker).length, 1, "FLOW-25 one archive for a watchdog stop");
  assert.equal(clock.pending(), 0, "FLOW-28 no timer left after workflow done");
});

test("FLOW-27 isolation creates one worktree per call on harness/<runId>-<n>; outside git -> null", async () => {
  const s = setup({ git: true });
  s.project.write("wf.js", `${meta()}await agent("a", { isolation: "worktree" }); await agent("b", { isolation: "worktree" });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_i"]);
  assert.equal(r.code, 0, r.stderr);
  const branches = s.project.git("branch", "--list", "harness/*");
  assert.match(branches, /harness\/wf_i-1/);
  assert.match(branches, /harness\/wf_i-2/);
  assert.match(created(s.fake)[0].initialPrompt, /You work in the git worktree .*wf_i-1 \(branch harness\/wf_i-1\)/);
  const n = setup({ git: false });
  n.project.write("wf.js", `${meta()}return await agent("a", { isolation: "worktree" });`);
  await n.ph(["workflow", "--script", "wf.js", "--run-id", "wf_n"]);
  assert.equal(done(n, "wf_n")[0].reason, "isolation 'worktree' needs a git repository");
  assert.equal(n.fake.callsOf("createAgent").length, 0);
});

const ROLE = "---\nname: reviewer\ntools: Read, Grep\n---\nYou review things.\n";

test("FLOW-28 defaults: one prompt per agent; priming on: READY turn with the read-only note, then the task", async () => {
  const d = setup({ files: { ".agents/agents/rev.md": ROLE } });
  d.project.write("wf.js", `${meta()}return await agent("check x", { agentType: "rev" });`);
  assert.equal((await d.ph(["workflow", "--script", "wf.js"])).code, 0);
  assert.equal(sent(d.fake).length, 0);
  const s = setup({ overlay: { prime_role: "two-turn" }, files: { ".agents/agents/rev.md": ROLE } });
  s.project.write("wf.js", `${meta()}return await agent("check x", { agentType: "rev", schema: { type: "object", properties: {} } });`);
  s.fake.setResponder((a, text) => [{ reply: text.startsWith("Task") ? "{}" : "READY" }]);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  const [c] = created(s.fake);
  assert.match(c.initialPrompt, /Read-only role/);
  assert.match(c.initialPrompt, /Reply with the single word READY/);
  assert.equal(c.outputSchema, undefined);
  const [[, task]] = sent(s.fake);
  assert.match(task, /^Task \(your role, rev, and its files are in the first message; do not open them again\):/);
  assert.match(task, /matches this JSON schema/);
  assert.ok(r.out.some((l) => /^agent start #1 agent \S{8} circle-agent\/m prime:two-turn$/.test(l)));
});

test("FLOW-28 warm-up on: the 2nd and 3rd same-type creates wait for the first agent's gate", async () => {
  const s = setup({ overlay: { warmup: true }, files: { ".agents/agents/rev.md": ROLE } });
  s.project.write("wf.js", `${meta()}return await parallel([1, 2, 3].map((i) => () => agent("p" + i, { agentType: "rev" })));`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  const order = s.fake.calls.map((c) => c.method).filter((m) => m === "createAgent" || m === "archiveAgent");
  assert.deepEqual(order.slice(0, 2), ["createAgent", "archiveAgent"]);
  assert.equal(s.clock.pending(), 0);
});

test("FLOW-14 19 running teammates: at most one call runs until a teammate goes idle", async () => {
  const clock = createFakeClock({ auto: false });
  const s = setup({ clock, responder: () => [{ manual: true }] });
  const mates = Array.from({ length: 19 }, () => s.fake.addAgent({ parent: CALLER, status: "running" }).id);
  s.project.write("wf.js", `${meta()}return await parallel([1, 2, 3, 4, 5].map((i) => () => agent("p" + i)));`);
  let freed = false;
  const own = () => created(s.fake).length;
  const r = await drive(s, ["workflow", "--script", "wf.js"], {
    onStep: async (i) => {
      if (i === 20) {
        assert.equal(own(), 1);
        s.fake.finish(mates[0], [{ reply: "idle" }]);
        freed = true;
      }
      if (i === 30) assert.equal(own(), 2);
      for (const a of s.fake.agents.values()) if (a.status === "running" && a.labels["harness.run"] && i > 30) s.fake.finish(a.id, [{ reply: "ok" }]);
    },
  });
  assert.ok(freed);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.out.includes("log waiting for a free agent slot (20 running of 20)"));
});

test("FLOW-14 41 session keys under max_live_subagents 40: call 41 null at once; reuse of session 1 still runs", async () => {
  const s = setup({ overlay: { max_live_subagents: 40 } });
  s.project.write("wf.js", `${meta()}const r = []; for (let i = 0; i < 41; i++) r.push(await agent("p" + i, { session: "s" + i })); r.push(await agent("again", { session: "s0" })); return r.map((x) => x === null);`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_l"]);
  assert.equal(r.code, 0, r.stderr);
  const res = result(s, "wf_l");
  assert.deepEqual([res[40], res[41], res.slice(0, 40).some(Boolean)], [true, false, false]);
  assert.equal(done(s, "wf_l")[40].reason, "live agent cap reached (40 of 40); end sessions or archive idle agents");
  assert.ok(!r.out.some((l) => l.startsWith("log waiting")));
});

test("FLOW-47 a later session call changing a fixed property throws before anything is created", async () => {
  const changes = [["readOnly: true"], ["cwd: 'sub'"], ["role: 'planner'"], ["agentType: 'rev'"], ["model: 'other/x'"]];
  for (const [change] of changes) {
    const s = setup({ files: { ".agents/agents/rev.md": ROLE } });
    s.project.write("wf.js", `${meta()}await agent("a", { session: "s" }); await agent("b", { session: "s", ${change} });`);
    const r = await s.ph(["workflow", "--script", "wf.js"]);
    assert.equal(r.code, 2, change);
    assert.match(r.out.at(-1), /session s cannot change \w+; use a new session key/, change);
    assert.equal(s.fake.callsOf("createAgent").length, 1, change);
  }
});

test("FLOW-47 session calls with different schemas are validated each by their own, no native outputSchema", async () => {
  const s = setup({ responder: (a, text) => [{ reply: text.includes("first") ? '{"a":1}' : '{"b":"x"}' }] });
  const A = { type: "object", properties: { a: { type: "integer" } }, required: ["a"] };
  const B = { type: "object", properties: { b: { type: "string" } }, required: ["b"] };
  s.project.write("wf.js", `${meta()}return [await agent("first", { session: "s", schema: ${JSON.stringify(A)} }), await agent("second", { session: "s", schema: ${JSON.stringify(B)} })];`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_v"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(result(s, "wf_v"), [{ a: 1 }, { b: "x" }]);
  assert.equal(created(s.fake)[0].outputSchema, undefined);
  assert.match(sent(s.fake)[0][1], /"b"/);
});

test("FLOW-47 FLOW-48 a session worktree is made once and reused on resume; adopted agent recorded and tagged", async () => {
  const s = setup({ git: true });
  const call = (p) => `await agent("${p}", { session: "coder", isolation: "worktree", keep: true });`;
  s.project.write("wf1.js", `${meta()}${call("one")}${call("two")}`);
  assert.equal((await s.ph(["workflow", "--script", "wf1.js", "--run-id", "wf_1"])).code, 0);
  s.project.write("wf2.js", `${meta()}${call("one")}${call("two")}${call("three")}`);
  const r = await s.ph(["workflow", "--resume", "wf_1", "--script", "wf2.js", "--run-id", "wf_2"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(s.fake.callsOf("createAgent").length, 1);
  const agentId = created(s.fake).length && journal(s, "wf_1")[1].agentId;
  assert.deepEqual(readRun(s, "wf_2").adopted, [{ agentId, session: "coder", fromRun: "wf_1" }]);
  assert.equal(s.fake.agents.get(agentId).labels["harness.run"], "wf_2", "adopted agent's harness.run label moved to the new run");
  const prompts = [created(s.fake)[0].initialPrompt, ...sent(s.fake).map(([, t]) => t)];
  assert.equal(prompts.length, 3);
  const wt = /You work in the git worktree (.+?) \(branch/.exec(prompts[0])[1];
  assert.match(sent(s.fake).at(-1)[1], /Run wf_2 #3 \(bookkeeping only; ignore\)\.$/);
  assert.equal(journal(s, "wf_2").find((e) => e.status === "ok").worktree.path, wt);
  assert.equal(s.project.git("worktree", "list").split("\n").length, 2);
  const archive = await s.ph(["archive", "--run", "wf_2"]);
  assert.equal(archive.code, 0, archive.stderr);
  assert.ok(s.fake.agents.get(agentId).archivedAt);
});

test("FLOW-12 FLOW-47 two parallel first calls of one session make one agent, and run end archives it", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return await parallel([() => agent("a", { session: "s" }), () => agent("b", { session: "s" })]);`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_p"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(result(s, "wf_p"), ["ok", "ok"]);
  assert.equal(created(s.fake).length, 1);
  assert.equal(sent(s.fake).length, 1);
  assert.ok([...s.fake.agents.values()].filter((x) => x.id !== CALLER).every((x) => x.archivedAt));
});

test("FLOW-04 timeoutS bounds the whole call across provider retries: a reply after the deadline is null", async () => {
  const s = setup({ responder: (a, text, { turn }) => [turn === 1 ? { error: "overloaded" } : { reply: "late success" }] });
  s.project.write("wf.js", `${meta()}return await agent("x", { timeoutS: 5, detail: true });`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_d"]);
  assert.equal(r.code, 0, r.stderr);
  const got = result(s, "wf_d");
  assert.deepEqual([got.result, got.reason], [null, "no reply within 5 s"]);
  assert.ok(got.durationS <= 5, `durationS ${got.durationS}`);
  assert.ok(s.fake.agents.get(got.agentId).archivedAt);
  assert.equal(s.clock.pending(), 0);
});

test("FLOW-15 FLOW-27 a non-session isolated detail call keeps its worktree path through two resume generations", async () => {
  const s = setup({ git: true });
  s.project.write("wf.js", `${meta()}return await agent("implement", { isolation: "worktree", detail: true });`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_1"])).code, 0);
  const first = result(s, "wf_1");
  assert.ok(first.worktree && fs.existsSync(first.worktree));
  assert.equal((await s.ph(["workflow", "--resume", "wf_1", "--run-id", "wf_2"])).code, 0);
  assert.equal((await s.ph(["workflow", "--resume", "wf_2", "--run-id", "wf_3"])).code, 0);
  for (const id of ["wf_2", "wf_3"]) assert.deepEqual(result(s, id), { ...first, durationS: 0 }, id);
  assert.equal(created(s.fake).length, 1);
  assert.equal(s.project.git("worktree", "list").trim().split("\n").length, 2);
});
