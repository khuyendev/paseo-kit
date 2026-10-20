import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { isReadOnlyTools } from "../../ship/.agents/harness/runtime/agents.mjs";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { fakeEngine } from "./fake-engine.mjs";
import { scratch } from "./helpers.mjs";

const NAMES = ["read_ranges", "edit_multiple_files", "write_multiple_files"];
const natives = (log, action) => log.bash.filter((b) => b.command.includes(action)).length;

test("FTOL-01 session.start registers exactly the three tools, not deferred", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  await f.start();
  assert.deepEqual(f.log.registered.map((t) => t.name), NAMES);
  assert.ok(f.log.registered.every((t) => t.isDeferred === false && t.inputSchema.type === "object"));
  for (const extra of [[...NAMES, "read_file"], NAMES.slice(1), [...NAMES.slice(1), "list_directory"]]) {
    const g = await fakeEngine({ cwd: s.root, backendReply: (input, real) => (input.action === "describe"
      ? { exitCode: 0, stdout: JSON.stringify({ protocol: 1, tools: extra.map((name) => ({ name, description: name, inputSchema: { type: "object" } })) }), stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
      : real(input)) });
    await assert.rejects(g.start(), /Unexpected file tool registry/);
    assert.equal(g.log.registered.length, 0);
  }
});

test("FTOL-39 handlers exist only for the three mod tools; nothing denies native Read, Edit or Write", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  assert.deepEqual(f.log.matchers, NAMES.map((n) => `mcp__harness-files__${n}`));
  const src = fs.readFileSync(path.join(SHIP_DIR, ".claude/plugins/harness-files/hooks/register.ts"), "utf8");
  assert.doesNotMatch(src, /tool: ['"](Read|Edit|Write)['"][^)]*deny/);
  assert.doesNotMatch(src, /on\(['"]tool\.call['"],\s*\{\s*tool:\s*['"](Read|Edit|Write|Bash)['"]/);
  const defaults = JSON.parse(fs.readFileSync(path.join(SHIP_DIR, ".agents/harness.defaults.json"), "utf8"));
  for (const key of ["agent_provider_disallowed_tools", "main_provider_disallowed_tools"]) {
    for (const native of ["Read", "Edit", "Write"]) assert.ok(!defaults[key].includes(native), `${key} denies ${native}`);
  }
});

test("FTOL-07 a call runs stage, native plan, plan checks, native execute and collect; commands carry no payload", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  const small = await f.call("write_multiple_files", { files: [{ path: "a.txt", content: "0123456789" }] });
  assert.match(small.result, /^wrote .*a\.txt \(10 chars\)$/);
  assert.deepEqual(f.log.actions, ["stage", "collect-plan", "collect-result"]);
  const big = await f.call("write_multiple_files", { files: [{ path: "a.txt", content: "P".repeat(100000) }] });
  assert.match(big.result, /\(100000 chars\)/);
  const cmds = f.log.bash.map((b) => b.command);
  assert.equal(cmds.length, 4);
  for (const action of ["--plan", "--execute"]) assert.equal(new Set(cmds.filter((c) => c.includes(action)).map((c) => c.length)).size, 1);
  assert.ok(cmds.every((c) => !c.includes("PPPP") && !c.includes("0123456789")));
  assert.ok(f.log.bash.every((b) => b.tool === "Bash" && b.timeout === 120000));
  const backendQuoted = `'${path.join(s.root, ".agents/harness/files/backend.mjs").replaceAll("\\", "/")}'`;
  assert.ok(cmds.every((c) => c.length <= backendQuoted.length + 200 && c.startsWith(`node ${backendQuoted} --`)));
  assert.ok(f.log.processes.filter((p) => !String(p.argv[1]).endsWith("discover.mjs")).every((p) => p.argv.length === 2 && typeof p.init.stdin === "string" && p.init.timeoutMs === 30000));
  const noSentinel = await fakeEngine({ cwd: s.root, bash: () => ({ result: { stdout: "done\n" } }) });
  const r = await noSentinel.call("read_ranges", { ranges: [{ path: "a.txt" }] });
  assert.ok(r.deny);
  assert.equal(natives(noSentinel.log, "--execute"), 0);
});

for (const decision of ["ask", "deny"]) {
  test(`FTOL-08 ${decision} before staging refuses with zero stage and native calls`, async () => {
    const s = scratch();
    const f = await fakeEngine({ cwd: s.root, verdict: () => ({ decision, reason: decision === "deny" ? undefined : undefined }) });
    const r = await f.call("write_multiple_files", { files: [{ path: "a.txt", content: "large payload".repeat(1000) }] });
    assert.equal(r.deny, `Read permission ${decision}: use the native tool for this path; this adapter fails closed on ask/deny`);
    assert.deepEqual(f.log.actions, []);
    assert.equal(f.log.bash.length, 0);
  });
}

test("FTOL-08 a non-allow ceiling also refuses", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root, verdict: () => ({ decision: "allow", ceiling: "ask" }) });
  assert.match((await f.call("read_ranges", { ranges: [{ path: "x" }] })).deny, /permission allow/);
});

test("FTOL-08 deny only on the guessed canonical path: no execute, ticket withdrawn", async () => {
  const s = scratch({ "specs/20-creature/X.md": "real" });
  const guess = s.path("specs/20-creature/X.md");
  const f = await fakeEngine({ cwd: s.root, verdict: (q) => (q.input.file_path === guess ? { decision: "deny", reason: "guess denied" } : { decision: "allow" }) });
  const r = await f.call("read_ranges", { ranges: [{ path: "specs/20-species/X.md" }] });
  assert.equal(r.deny, "Read permission deny: guess denied");
  assert.deepEqual(f.log.actions, ["stage", "collect-plan", "abandon"]);
  assert.equal(natives(f.log, "--execute"), 0);
});

test("FTOL-08 new/dir/f.txt plans Write checks for both missing ancestors", async () => {
  const s = scratch();
  const f = await fakeEngine({ cwd: s.root });
  await f.call("write_multiple_files", { files: [{ path: "new/dir/f.txt", content: "x" }] });
  const writes = f.log.checks.filter((c) => c.tool === "Write" && c.input.content === "").map((c) => c.input.file_path);
  assert.ok(writes.includes(s.path("new")) && writes.includes(s.path("new/dir")) && writes.includes(s.root));
});

test("FTOL-08 an allowed Edit whose parent-folder Write is denied starts no execution and leaves no temp", async () => {
  const s = scratch({ "d/e.txt": "e" });
  const f = await fakeEngine({ cwd: s.root, verdict: (q) => (q.tool === "Write" && q.input.file_path === s.path("d") ? { decision: "deny" } : { decision: "allow" }) });
  const r = await f.call("edit_multiple_files", { files: [{ path: "d/e.txt", edits: [{ oldText: "e", newText: "E" }] }] });
  assert.match(r.deny, /^Write permission deny/);
  assert.equal(natives(f.log, "--execute"), 0);
  assert.equal(s.read("d/e.txt"), "e");
  assert.deepEqual(fs.readdirSync(s.path("d")), ["e.txt"]);
});

test("FTOL-10 ask and deny verdicts refuse without touching Claude or Paseo settings", async () => {
  const s = scratch({ "home/.claude/settings.json": '{"permissions":{"defaultMode":"default"}}\n', "home/.paseo/config.json": '{"providers":{}}\n' });
  const before = [s.bytes("home/.claude/settings.json"), s.bytes("home/.paseo/config.json")];
  for (const decision of ["ask", "deny"]) {
    const f = await fakeEngine({ cwd: s.root, verdict: (q) => (q.tool === "Read" ? { decision: "allow" } : { decision }) });
    const w = await f.call("write_multiple_files", { files: [{ path: "scratch.txt", content: "x" }] });
    assert.match(w.deny, new RegExp(`^Write permission ${decision}: use the native tool for this path`));
    const e = await f.call("edit_multiple_files", { files: [{ path: "scratch.txt", edits: [{ oldText: "a", newText: "b" }] }] });
    assert.match(e.deny, new RegExp(`^Edit permission ${decision}`));
  }
  assert.deepEqual([s.bytes("home/.claude/settings.json"), s.bytes("home/.paseo/config.json")], before);
  assert.equal(s.exists("scratch.txt"), false);
});

test("FTOL-06 protocol mismatch, truncated and empty replies fail closed before native execution", async () => {
  const s = scratch();
  const reply = (patch) => (input, real) => (input.action === "stage" ? { ...real(input), ...patch(real(input)) } : real(input));
  const cases = [
    [reply((r) => ({ stdout: r.stdout.replace('"protocol":1', '"protocol":9') })), /^Harness file mod\/backend protocol mismatch: update the installed project assets and plugin together$/],
    [reply(() => ({ isStdoutTruncated: true })), /^File transport failed: incomplete backend output$/],
    [reply(() => ({ stdout: "" })), /^File transport failed: incomplete backend output$/],
    [reply(() => ({ exitCode: 1, stdout: "", stderr: "boom" })), /^File transport failed: boom$/],
  ];
  for (const [backendReply, re] of cases) {
    const f = await fakeEngine({ cwd: s.root, backendReply });
    const r = await f.call("read_ranges", { ranges: [{ path: "a" }] });
    assert.match(r.deny, re);
    assert.equal(f.log.bash.length, 0);
  }
});

test("FTOL-12 recovered, unknown, not executed and pre-execute failures are distinct; one native execute at most", async () => {
  const s = scratch({ "a.txt": "a" });
  const write = { files: [{ path: "a.txt", content: "updated" }] };
  // 1. execute ran, its Bash reply was lost: the receipt is recovered
  const rec = await fakeEngine({ cwd: s.root, bash: (q, real) => (q.command.includes("--execute") ? (real(q.command), { deny: "receipt delivery failed" }) : real(q.command)) });
  const r1 = await rec.call("write_multiple_files", write);
  assert.match(r1.result, /^Recovered completed execution receipt; operation was not repeated\.\nwrote /);
  assert.equal(natives(rec.log, "--execute"), 1);
  // 2. execute started but never finished: outcome unknown
  let stateDir;
  const unk = await fakeEngine({ cwd: s.root, bash: (q, real) => {
    if (!q.command.includes("--execute")) return real(q.command);
    const [session, ticket] = q.command.split(" ").slice(-2);
    stateDir = path.join(unk.stateRoot, session);
    fs.writeFileSync(path.join(stateDir, `${ticket}.started`), "1");
    return { deny: "killed" };
  } });
  const r2 = await unk.call("write_multiple_files", write);
  assert.match(r2.result, /^EXECUTION OUTCOME UNKNOWN: target files may already have changed\. Do not repeat the mutation blindly\. Recover its result on this same tool with \{"receipt":"[a-f0-9]{64}"\}/);
  assert.equal(natives(unk.log, "--execute"), 1);
  // 3. the native execute was denied and never started: withdrawn, nothing changed
  s.write("a.txt", "a");
  const not = await fakeEngine({ cwd: s.root, bash: (q, real) => (q.command.includes("--execute") ? { deny: "Bash denied by rule" } : real(q.command)) });
  const r3 = await not.call("write_multiple_files", write);
  assert.equal(r3.deny, "Not executed; no target changed. Bash denied by rule");
  assert.equal(natives(not.log, "--execute"), 1);
  assert.equal(s.read("a.txt"), "a");
  // 4. failure before the execute call: its own cause
  const pre = await fakeEngine({ cwd: s.root, verdict: (q) => (q.tool === "Write" && q.input.content === "" ? { decision: "deny", reason: "folder" } : { decision: "allow" }) });
  const r4 = await pre.call("write_multiple_files", write);
  assert.equal(r4.deny, "Write permission deny: folder");
  assert.equal(natives(pre.log, "--execute"), 0);
});

test("FTOL-11 a receipt through the mod returns the stored result without rerunning", async () => {
  const s = scratch({ "a.txt": "a" });
  const f = await fakeEngine({ cwd: s.root });
  await f.call("write_multiple_files", { files: [{ path: "a.txt", content: "v2" }] });
  const ticket = /--execute \S+ (\S+)$/.exec(f.log.bash.at(-1).command)[1];
  s.write("a.txt", "reset");
  const r = await f.call("write_multiple_files", { receipt: ticket });
  assert.match(r.result, /^wrote .*a\.txt \(2 chars\)$/);
  assert.equal(s.read("a.txt"), "reset");
  assert.equal(natives(f.log, "--execute"), 1);
});

test("FTOL-13 the mod refuses a backend text over 44,000 characters", async () => {
  const s = scratch({ "a.txt": "a" });
  const f = await fakeEngine({ cwd: s.root, backendReply: (input, real) => (input.action === "collect" && !input.phase
    ? { exitCode: 0, stdout: JSON.stringify({ protocol: 1, text: "x".repeat(44001) }), stderr: "", isStdoutTruncated: false, isStderrTruncated: false }
    : real(input)) });
  const r = await f.call("read_ranges", { ranges: [{ path: "a.txt" }] });
  assert.match(r.deny ?? r.result, /exceeds the safe page size/);
});

test("FTOL-40 a native subagent call is refused before any check or process", async () => {
  const s = scratch({ "a.txt": "a" });
  const f = await fakeEngine({ cwd: s.root });
  const r = await f.call("read_ranges", { ranges: [{ path: "a.txt" }] }, { agentId: "child-1" });
  assert.match(r.deny, /^Harness file backend is unavailable inside a native subagent: .* Use native Read\/Edit\/Write\/Bash; these built-ins are unchanged\.$/);
  assert.equal(f.log.processes.length, 0);
  assert.equal(f.log.checks.length, 0);
  const ok = await f.call("read_ranges", { ranges: [{ path: "a.txt" }] });
  assert.match(ok.result, /1\| a/);
});

test("FTOL-38 read-only classification (runtime/agents.mjs) knows the mod tools on token boundaries", () => {
  assert.equal(isReadOnlyTools("Read, Grep, mcp__harness-files__read_ranges"), true);
  assert.equal(isReadOnlyTools("Read, Grep, mcp__harness-files__read_ranges, mcp__harness-files__edit_multiple_files"), false);
  assert.equal(isReadOnlyTools('["Read", "mcp__harness-files__write_multiple_files"]'), false);
  assert.equal(isReadOnlyTools(["Read", "Write"]), false);
  assert.equal(isReadOnlyTools("Read, EditorNotes"), true);
  assert.equal(isReadOnlyTools("Read, mcp__fsbatch__edit_multiple_files"), true);
  assert.equal(isReadOnlyTools(undefined), false);
});
