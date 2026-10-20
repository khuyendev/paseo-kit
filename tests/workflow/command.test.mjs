import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readJournal } from "../../ship/.agents/harness/workflow/journal.mjs";
import { CALLER, meta, setup } from "./helpers.mjs";

const runsDir = (project) => project.path("_workspace/_runs");
const runIds = (project) => (fs.existsSync(runsDir(project)) ? fs.readdirSync(runsDir(project)) : []);
const runFile = (project, id, f) => path.join(runsDir(project), id, f);
const readRun = (project, id) => JSON.parse(fs.readFileSync(runFile(project, id, "run.json"), "utf8"));
const lastRun = (project) => runIds(project).sort().pop();
const created = (fake) => fake.callsOf("createAgent").map((c) => c.args[0]);
const sent = (fake) => fake.callsOf("sendAgentMessage").map((c) => c.args);

const LINE = {
  start: /^workflow start wf_\S+ .+$/,
  phase: /^phase .+$/,
  log: /^log .+$/,
  agentStart: /^agent start #\d+ \S.* [0-9a-f-]{8} \S+\/\S+( prime:two-turn)?$/,
  agentDone: /^agent done #\d+ \S.* (ok|null \(.+\)) tokens=\d+ cost=(\?|[\d.]+) (\d+|\?)s$/,
  agentCached: /^agent cached #\d+ .+$/,
  shell: /^shell (start|done) #\d+ .+$/,
  end: /^workflow (done|failed) wf_\S+: .+$/,
};

test("FLOW-20 no flags or an invalid overlay -> exit 1 and no run dir", async () => {
  const s = setup();
  const r = await s.ph(["workflow"]);
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /usage error: give --script or --name/);
  s.project.write("wf.js", `${meta()}return 1;`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--name", "x"])).code, 1);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--args", "{}", "--args-file", "a.json"])).code, 1);
  s.project.writeJson(".agents/harness.config.json", { max_subagents: "x" });
  const bad = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(bad.code, 1);
  assert.match(bad.err.join("\n"), /invalid harness config max_subagents/);
  assert.deepEqual(runIds(s.project), []);
});

test("FLOW-20 a throwing script exits 2 with status failed; FDC success exits 0 with the final line", async () => {
  const s = setup();
  s.project.write("bad.js", `${meta()}throw new Error("nope");`);
  const bad = await s.ph(["workflow", "--script", "bad.js"]);
  assert.equal(bad.code, 2);
  const id = lastRun(s.project);
  assert.equal(readRun(s.project, id).status, "failed");
  assert.equal(readRun(s.project, id).error, "nope");
  assert.ok(!fs.existsSync(runFile(s.project, id, "result.json")));
  s.project.write("ok.js", `${meta("ok")}return await agent("hi");`);
  const ok = await s.ph(["workflow", "--script", "ok.js"]);
  assert.equal(ok.code, 0, ok.stdout + ok.stderr);
  assert.match(ok.out.at(-1), /^workflow done wf_\S+: .+result\.json \(ok 1, null 0, cached 0, tokens 5, cost \$\?\)$/);
});

test("FLOW-20 a missing daemon after the checks fails the run with exit 2", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const { createFakeDaemon } = await import("../fakes/fake-daemon.mjs");
  const r = await s.ph(["workflow", "--script", "wf.js"], { fake: createFakeDaemon({ down: "refused" }) });
  assert.equal(r.code, 2);
  assert.match(readRun(s.project, lastRun(s.project)).error, /Cannot connect to daemon/);
});

test("FLOW-18 a done run has all six files, run.json counts, atomic 2-space JSON", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta("six")}const a = await agent("x"); return { a };`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--args", '{"k":1}', "--budget", "500k"]);
  assert.equal(r.code, 0, r.stderr);
  const id = lastRun(s.project);
  for (const f of ["script.js", "args.json", "run.json", "journal.jsonl", "log.txt", "result.json"]) assert.ok(fs.existsSync(runFile(s.project, id, f)), f);
  const info = readRun(s.project, id);
  assert.equal(info.status, "done");
  assert.equal(info.name, "six");
  assert.equal(info.budget, 500000);
  assert.equal(info.pid, process.pid);
  assert.deepEqual({ ...info.agents, costUsd: undefined }, { started: 1, ok: 1, null: 0, cached: 0, tokens: 5, costUsd: undefined });
  assert.ok(fs.readFileSync(runFile(s.project, id, "run.json"), "utf8").endsWith("}\n"));
  assert.deepEqual(JSON.parse(fs.readFileSync(runFile(s.project, id, "result.json"), "utf8")), { a: "ok" });
  assert.deepEqual(JSON.parse(fs.readFileSync(runFile(s.project, id, "args.json"), "utf8")), { k: 1 });
});

test("FLOW-19 run ids are wf_<date>-<time>_<hex>; --run-id is used verbatim", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  await s.ph(["workflow", "--script", "wf.js"]);
  assert.match(lastRun(s.project), /^wf_\d{8}-\d{6}_[0-9a-f]{4}$/);
  await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_x"]);
  assert.ok(runIds(s.project).includes("wf_x"));
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "../x"])).code, 1);
});

test("FLOW-22 every log line of a fixture run matches one line type", async () => {
  const s = setup({ responder: (agent, text) => [{ reply: text.includes("fail") ? "" : "ok", usage: { outputTokens: 2 } }] });
  s.project.write("wf.js", `${meta("g", `, phases: [{ title: "A" }]`)}phase("A"); log("hello"); await agent("x"); await agent("fail"); await shell("exit 0"); return 1;`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  const lines = fs.readFileSync(runFile(s.project, lastRun(s.project), "log.txt"), "utf8").trim().split("\n");
  for (const l of lines) assert.ok(Object.values(LINE).some((re) => re.test(l)), l);
  assert.ok(lines.some((l) => LINE.agentStart.test(l)) && lines.some((l) => /^agent done #2 A null \(finished without a reply\)/.test(l)));
  assert.deepEqual(lines, r.out);
});

test("FLOW-25 labels, title, worker env; every non-session agent archived after its call unless keep", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta("lab")}await agent("a", { label: "first" }); await agent("b", { keep: true });`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_lab"])).code, 0);
  const [a, b] = created(s.fake);
  assert.equal(a.title, "lab:first");
  assert.deepEqual({ run: a.labels["harness.run"], name: a.labels["harness.name"], swarm: a.labels["ph.swarm"], parent: a.labels["paseo.parent-agent-id"] }, { run: "wf_lab", name: "first", swarm: "lab", parent: CALLER });
  assert.equal(a.env.PASEO_HARNESS_ROLE, "worker");
  const live = [...s.fake.agents.values()].filter((x) => x.labels["harness.run"] === "wf_lab" && !x.archivedAt);
  assert.deepEqual(live.map((x) => x.title), ["lab:agent"]);
  assert.equal(s.fake.callsOf("archiveAgent").length, 1);
  assert.equal(b.labels["harness.name"], "agent");
});

test("FLOW-12 a session: one create, two prompts; a fresh call makes a new agent; run end archives it", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta("ses")}await agent("one", { session: "coder:a" }); await agent("two", { session: "coder:a" }); await agent("solo");`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js"])).code, 0);
  const creates = created(s.fake);
  assert.equal(creates.length, 2);
  const sessionId = [...s.fake.agents.values()].find((x) => x.title === "ses:agent" && x.labels["harness.run"] && s.fake.callsOf("sendAgentMessage").some((c) => c.args[0] === x.id)).id;
  assert.equal(sent(s.fake).filter(([id]) => id === sessionId).length, 1);
  assert.ok(s.fake.callsOf("archiveAgent").some((c) => c.args[0] === sessionId));
  assert.ok([...s.fake.agents.values()].filter((x) => x.id !== CALLER).every((x) => x.archivedAt));
});

test("FLOW-12 a failed session call archives its agent and the next call starts a new one", async () => {
  const s = setup({ responder: (agent, text) => [{ reply: text.includes("bad") ? "" : "ok", usage: { outputTokens: 1 } }] });
  s.project.write("wf.js", `${meta()}const a = await agent("bad", { session: "s" }); const b = await agent("good", { session: "s" }); return [a, b];`);
  const r = await s.ph(["workflow", "--script", "wf.js"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(created(s.fake).length, 2);
  assert.equal(sent(s.fake).length, 0);
});

test("FLOW-16 resume: a zero-agent run resumes; missing id exits 1; parent recorded; saved script and args reused", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return args;`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_a", "--args", '{"x":2}'])).code, 0);
  assert.equal(fs.readFileSync(runFile(s.project, "wf_a", "journal.jsonl"), "utf8"), "");
  const r = await s.ph(["workflow", "--resume", "wf_a", "--run-id", "wf_b"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readRun(s.project, "wf_b").parent, "wf_a");
  assert.deepEqual(JSON.parse(fs.readFileSync(runFile(s.project, "wf_b", "result.json"), "utf8")), { x: 2 });
  const missing = await s.ph(["workflow", "--resume", "wf_none"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err.join("\n"), /cannot resume: .*journal\.jsonl not found/);
});

test("FLOW-08 --args-file with a BOM; --resume alone reuses saved args", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return args.a;`);
  s.project.write("a.json", '﻿{"a": 5}');
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--args-file", "a.json", "--run-id", "wf_f"])).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(runFile(s.project, "wf_f", "result.json"), "utf8")), 5);
  assert.equal((await s.ph(["workflow", "--resume", "wf_f", "--run-id", "wf_g"])).code, 0);
  assert.equal(JSON.parse(fs.readFileSync(runFile(s.project, "wf_g", "result.json"), "utf8")), 5);
});

test("FLOW-09 --budget 2x is a usage error", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const r = await s.ph(["workflow", "--script", "wf.js", "--budget", "2x"]);
  assert.equal(r.code, 1);
  assert.match(r.err.join("\n"), /invalid --budget/);
});

test("FLOW-10 --name and workflow() find saved scripts only in .agents/workflows", async () => {
  const s = setup({ files: { ".agents/workflows/child.mjs": `${meta("child")}return "c";`, ".claude/workflows/other.js": `${meta("o")}return 1;` } });
  s.project.write(".agents/workflows/parent.js", `${meta("parent")}return [await workflow("child"), await workflow("other").catch((e) => e.message)];`);
  const r = await s.ph(["workflow", "--name", "parent"]);
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(runFile(s.project, lastRun(s.project), "result.json"), "utf8")), ["c", "no saved workflow 'other' in .agents/workflows/"]);
});

test("FLOW-11 resume reruns shell calls", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}await agent("a"); return (await shell("exit 0")).code;`);
  await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_s1"]);
  const r = await s.ph(["workflow", "--resume", "wf_s1", "--run-id", "wf_s2"]);
  assert.ok(r.out.includes("agent cached #1 agent") && r.out.some((l) => l.startsWith("shell done #1 code=0")));
  assert.ok(readJournal(runFile(s.project, "wf_s2", "journal.jsonl")).some((e) => e.kind === "shell"));
});

test("FLOW-19 dot-only ids are refused for --run-id and --resume; nothing written outside the runs dir", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  for (const id of [".", "..", "..."]) {
    const r = await s.ph(["workflow", "--script", "wf.js", "--runs-dir", ".", "--run-id", id]);
    assert.equal(r.code, 1, id);
    assert.match(r.err.join("\n"), /invalid --run-id/);
    assert.equal((await s.ph(["workflow", "--resume", id])).code, 1, id);
  }
  for (const f of ["script.js", "args.json", "run.json"]) assert.ok(!fs.existsSync(s.project.path(f)), f);
});

test("FLOW-18 FLOW-19 an existing run id is refused with exit 1 and its files stay byte-identical, resume onto itself too", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return await agent("a");`);
  assert.equal((await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_x"])).code, 0);
  const snap = () => Object.fromEntries(fs.readdirSync(path.join(runsDir(s.project), "wf_x")).map((f) => [f, fs.readFileSync(runFile(s.project, "wf_x", f), "utf8")]));
  const before = snap();
  s.project.write("other.js", `${meta()}return 2;`);
  const again = await s.ph(["workflow", "--script", "other.js", "--run-id", "wf_x"]);
  assert.equal(again.code, 1);
  assert.match(again.err.join("\n"), /run wf_x already exists/);
  const self = await s.ph(["workflow", "--resume", "wf_x", "--run-id", "wf_x"]);
  assert.equal(self.code, 1);
  assert.deepEqual(snap(), before);
});

test("FLOW-19 two concurrent starts with one run id: exactly one runs", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const codes = (await Promise.all([1, 2].map(() => s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_c"])))).map((r) => r.code).sort();
  assert.deepEqual(codes, [0, 1]);
  assert.equal(readRun(s.project, "wf_c").status, "done");
});

test("FLOW-21 only the detached child named by its parent's claim reuses the run dir", async () => {
  const s = setup();
  s.project.write("wf.js", `${meta()}return 1;`);
  const dir = path.join(runsDir(s.project), "wf_d");
  fs.mkdirSync(dir, { recursive: true });
  const claim = (pid) => fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: "wf_d", status: "running", startedAt: "2026-10-20T00:00:00.000Z", pid }));
  claim(process.pid + 1_000_000);
  const env = { ...s.env, PASEO_HARNESS_CLAIMED_RUN_DIR: dir };
  const stranger = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_d"], { env });
  assert.equal(stranger.code, 1);
  assert.match(stranger.err.join("\n"), /was not started by a detaching ph workflow/);
  claim(process.pid);
  const child = await s.ph(["workflow", "--script", "wf.js", "--run-id", "wf_d"], { env });
  assert.equal(child.code, 0, child.stderr);
  assert.deepEqual([readRun(s.project, "wf_d").status, readRun(s.project, "wf_d").startedAt], ["done", "2026-10-20T00:00:00.000Z"]);
});
