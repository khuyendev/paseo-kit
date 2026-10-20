import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { READ_ONLY_DENIED_TOOLS } from "../../ship/.agents/harness/paseo-client/index.mjs";
import { assertErrLine, assertExit, assertLastLine, assertLine, assertNoLine } from "../helpers/assert.mjs";
import { CALLER, addSub, creates, setup } from "./setup.mjs";

test("PHCL-03 prompt input: exactly one of --prompt / --prompt-file; BOM stripped", async () => {
  const s = setup();
  assertErrLine(await s.ph(["spawn", "--name", "a", "--prompt", "x", "--prompt-file", "f"]), "usage error: use --prompt or --prompt-file, not both");
  const none = await s.ph(["spawn", "--name", "a"]);
  assertExit(none, 1);
  assertErrLine(none, "usage error: --prompt or --prompt-file is required");
  s.project.write("p.txt", "﻿Hello from file");
  assertExit(await s.ph(["spawn", "--name", "a", "--prompt-file", "p.txt"]), 0);
  assert.ok(creates(s.fake)[0].initialPrompt.startsWith("Hello from file\n"));
});

test("PHCL-05 spawn --count names agents N-1..N-K and returns with the wait hint", async () => {
  const s = setup();
  const r = await s.ph(["spawn", "--name", "x", "--count", "3", "--prompt", "work"]);
  assertExit(r, 0);
  for (const n of ["x-1", "x-2", "x-3"]) assertLine(r, new RegExp(`^[0-9a-f-]{36} ${n}$`));
  assertLastLine(r, /^next: wait with Monitor running `node ".*ph\.mjs" watch x-1 x-2 x-3`/);
  const c = creates(s.fake);
  assert.equal(c.length, 3);
  assert.equal(c[0].labels["ph.swarm"], "x");
  assert.equal(c[0].labels["paseo.parent-agent-id"], CALLER);
  assert.equal(c[0].provider, "circle-agent");
  assert.equal(c[0].model, "std-model[1m]");
  assert.match(c[0].initialPrompt, /You are the teammate "x-1"/);
  assertExit(await s.ph(["spawn", "--name", "y", "--count", "0", "--prompt", "w"]), 1);
});

test("PHCL-05 a duplicate live name is refused with zero creates; one failing create gives exit 2", async () => {
  const s = setup();
  addSub(s.fake, { title: "rev" });
  const dup = await s.ph(["spawn", "--name", "rev", "--prompt", "w"]);
  assertExit(dup, 1);
  assertErrLine(dup, "usage error: a live subagent already has the name rev (names must be unique)");
  assert.equal(creates(s.fake).length, 0);
  s.fake.failNext("createAgent", new Error("boom"));
  const r = await s.ph(["spawn", "--name", "z", "--count", "2", "--prompt", "w"]);
  assertExit(r, 2);
  assertLine(r, "failed spawn z-1: boom");
  assertLine(r, /^\S+ z-2$/);
  assertLastLine(r, /watch z-2`/);
});

test("PHCL-06 --cwd becomes a prompt instruction and the daemon cwd", async () => {
  const s = setup();
  assertExit(await s.ph(["spawn", "--name", "a", "--cwd", "sub", "--prompt", "w"]), 0);
  const c = creates(s.fake)[0];
  const sub = path.join(s.root, "sub");
  assert.equal(c.cwd, sub);
  assert.ok(c.initialPrompt.includes(`Your working directory for this task is ${sub}: run shell commands there`));
});

test("PHCL-07 hint quotes names with spaces; no hint when every create failed", async () => {
  const s = setup();
  const r = await s.ph(["spawn", "--name", "a b", "--prompt", "w"]);
  assertLastLine(r, /watch 'a b'` \(one event per idle agent, exits when all are idle\); do not poll with sleep\/grep loops$/);
  s.fake.failNext("createAgent", new Error("down"));
  const f = await s.ph(["spawn", "--name", "c", "--prompt", "w"]);
  assertExit(f, 2);
  assertNoLine(f, /^next:/);
});

test("PHCL-23 running-agent cap counts running subagents only", async () => {
  const s = setup();
  for (let i = 0; i < 19; i++) addSub(s.fake, { status: "running", title: `r${i}` });
  const r = await s.ph(["spawn", "--name", "n", "--count", "2", "--prompt", "w"]);
  assertExit(r, 1);
  assertErrLine(r, "usage error: 19 subagents running + 2 new > max_subagents 20 (harness config); wait, archive, or use a workflow (it queues)");
  assert.equal(creates(s.fake).length, 0);
  const t = setup();
  for (let i = 0; i < 18; i++) addSub(t.fake, { status: "running", title: `r${i}` });
  assertExit(await t.ph(["spawn", "--name", "n", "--count", "2", "--prompt", "w"]), 0);
  assert.equal(creates(t.fake).length, 2);
});

test("PHCL-24 live-agent cap for new agents; send needs no live slot", async () => {
  const s = setup();
  for (let i = 0; i < 39; i++) addSub(s.fake, { title: `i${i}` });
  const r = await s.ph(["spawn", "--name", "n", "--count", "2", "--prompt", "w"]);
  assertErrLine(r, "usage error: 39 live subagents + 2 new > max_live_subagents 40; archive idle agents (ph archive --idle)");
  addSub(s.fake, { title: "i39" });
  const sent = await s.ph(["send", "--prompt", "hi", "i0"]);
  assertExit(sent, 0);
  assertLine(sent, "sent i0");
});

test("PHCL-24 fanout --collect --keep with 39 live and 3 blocks: one runs, two hit the live cap", async () => {
  const s = setup();
  for (let i = 0; i < 39; i++) addSub(s.fake, { title: `i${i}` });
  s.project.write("f.txt", "=== a\nA\n=== b\nB\n=== c\nC\n");
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out", "--keep"]);
  assertExit(r, 2);
  assert.equal(creates(s.fake).length, 1);
  assert.equal(r.out.filter((l) => /^failed [bc]: live agent cap reached \(40 of 40\)$/.test(l)).length, 2);
  assert.equal(s.fake.callsOf("archiveAgent").length, 0);
});

test("PHCL-25 names over 60 characters are refused before any agent starts", async () => {
  const s = setup();
  const long = "n".repeat(61);
  const r = await s.ph(["spawn", "--name", long, "--prompt", "w"]);
  assertErrLine(r, `usage error: names longer than 60 characters: ${long}`);
  assert.equal(creates(s.fake).length, 0);
});

test("PHCL-09 fanout without --collect: validation before any create, then team agents", async () => {
  const s = setup();
  s.project.write("dup.txt", "=== A\nx\n=== a\ny\n");
  const dup = await s.ph(["fanout", "--file", "dup.txt"]);
  assertExit(dup, 1);
  assertErrLine(dup, /write the same output file/);
  const blocks = Array.from({ length: 21 }, (_, i) => `=== b${i}\nwork ${i}`).join("\n");
  s.project.write("many.txt", blocks);
  assertErrLine(await s.ph(["fanout", "--file", "many.txt"]), /0 subagents running \+ 21 new > max_subagents 20/);
  assert.equal(creates(s.fake).length, 0);
  s.project.write("ok.txt", "Pre.\n=== one model=pro\nA\n=== two\nB\n");
  const r = await s.ph(["fanout", "--file", "ok.txt", "--model", "frontier"]);
  assertExit(r, 0);
  assertLastLine(r, /watch one two`/);
  const [one, two] = creates(s.fake);
  assert.equal(one.model, "pro-model[1m]");
  assert.equal(two.model, "front-model[1m]");
  assert.match(two.initialPrompt, /^Pre\.\n\nB\n/);
  assert.match(two.initialPrompt, /You are the teammate "two"/);
});

test("PHCL-10 fanout --collect: one slot at a time, files written before archiving, archived on error too", async () => {
  const s = setup({ overlay: { max_subagents: 1 } });
  s.fake.setResponder((agent) => agent.title === "bad" ? [{ error: "quota exceeded" }] : [{ reply: `reply of ${agent.title}`, usage: { inputTokens: 1e6, outputTokens: 1e6 } }]);
  s.project.write(".agents/model-prices.json", JSON.stringify({ models: { "std-model": { input: 2, output: 10 } } }));
  s.project.write("f.txt", "=== good one\nA\n=== bad\nB\n");
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(r, 2);
  assert.equal(r.out[0], "waiting for 2 agent(s): this command returns when every reply is collected; run it in the foreground and do not poll its output");
  assertLine(r, /^collected good one -> .*good_one\.md$/);
  assertLine(r, "failed bad: agent error: quota exceeded");
  assert.equal(s.project.read("out/good_one.md"), "reply of good one\n");
  const json = s.project.readJson("out/good_one.json");
  assert.equal(json.final, "reply of good one");
  assert.deepEqual(json.tokens, { turns: 1, input: 1e6, cachedInput: 0, output: 1e6 });
  assert.equal(json.costUsd, 12);
  const calls = s.fake.calls.map((c) => c.method);
  // One slot: the second agent is created only after the first was archived; results are read before archiving.
  assert.ok(calls.indexOf("archiveAgent") < calls.lastIndexOf("createAgent"));
  assert.ok(calls.indexOf("fetchAgentTimeline") < calls.indexOf("archiveAgent"));
  assert.equal(s.fake.callsOf("archiveAgent").length, 2);
});

test("PHCL-10 fanout --collect refuses when no running slot is free", async () => {
  const s = setup({ overlay: { max_subagents: 1 } });
  addSub(s.fake, { status: "running", title: "busy" });
  s.project.write("f.txt", "=== a\nA\n");
  assertErrLine(await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]), "usage error: 1 subagents running, max_subagents 1: no free slot; wait or archive");
});

test("PHCL-27 read-only agents: note always, per-agent denies only with the client capability", async () => {
  const off = setup();
  assertExit(await off.ph(["spawn", "--name", "r", "--read-only", "--prompt", "w"]), 0);
  assert.equal(creates(off.fake)[0].disallowedTools, undefined);
  assert.match(creates(off.fake)[0].initialPrompt, /- Read-only role: do not create, edit, move or delete files/);
  const on = setup({ fake: { capabilities: { agentDisallowedTools: true } } });
  on.project.write("f.txt", "=== r\nReview.\n");
  const r = await on.ph(["fanout", "--file", "f.txt", "--collect", "out", "--read-only"]);
  assertExit(r, 0);
  assert.deepEqual(creates(on.fake)[0].disallowedTools, [...READ_ONLY_DENIED_TOOLS]);
  assert.equal(on.project.read("out/r.md"), "ok\n");
});

test("PHCL-33 a caller working outside the project root creates nothing", async () => {
  const s = setup();
  s.fake.agents.get(CALLER).cwd = path.parse(s.root).root + "other";
  const r = await s.ph(["spawn", "--name", "a", "--prompt", "w"]);
  assertExit(r, 1);
  assertErrLine(r, /^usage error: caller c0ffee00 works in .*other, outside the project root .*; run ph from an agent of this project$/);
  assert.equal(creates(s.fake).length, 0);
  s.fake.agents.get(CALLER).cwd = path.join(s.root, "sub");
  assertExit(await s.ph(["spawn", "--name", "a", "--prompt", "w"]), 0);
});

test("PHCL-22 --role picks the adapter role entry; an unknown role is a usage error", async () => {
  const s = setup({ overlay: { gsd: { roles: { planner: { model: "pro", effort: "max" } } } } });
  s.fake.setModels("circle-agent", [{ id: "pro-model[1m]", thinkingOptions: [{ id: "high" }, { id: "max" }] }]);
  assertExit(await s.ph(["spawn", "--name", "p", "--role", "planner", "--prompt", "w"]), 0);
  assert.equal(creates(s.fake)[0].model, "pro-model[1m]");
  assert.equal(creates(s.fake)[0].thinkingOptionId, "max");
  const bad = await s.ph(["spawn", "--name", "q", "--role", "nosuch", "--prompt", "w"]);
  assertExit(bad, 1);
  assertErrLine(bad, /usage error: unknown role 'nosuch'/);
});

test("PHCL-26 --type loads the definition; a path-like type is a usage error", async () => {
  const s = setup({ files: { ".agents/agents/rev.md": "---\ntools: Read\nmodel: frontier\n---\nBe strict.\n" } });
  assertExit(await s.ph(["spawn", "--name", "a", "--type", "rev", "--prompt", "w"]), 0);
  const c = creates(s.fake)[0];
  assert.equal(c.model, "front-model[1m]");
  assert.match(c.initialPrompt, /^Your role \(rev\), complete below:\n\nBe strict\.\n\n---\n\nw/);
  assert.ok(!fs.existsSync(path.join(s.root, ".claude", "agents")));
  assertErrLine(await s.ph(["spawn", "--name", "b", "--type", "../x", "--prompt", "w"]), /usage error: invalid agent type/);
});

test("PHCL-24 PHCL-10 collect: a failed create releases its admission, so later blocks hit the live cap instead of stalling", async () => {
  const s = setup({ overlay: { max_subagents: 1, max_live_subagents: 1 } });
  s.fake.setResponder(() => [{ error: "quota exceeded" }]);
  s.project.write("f.txt", "=== a\nA\n=== b\nB\n=== c\nC\n");
  s.fake.failNext("createAgent", new Error("boom"));
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out", "--keep"]);
  assertExit(r, 2);
  assertLine(r, /^failed a: .*boom/);
  assertLine(r, "failed b: agent error: quota exceeded");
  assertLine(r, "failed c: live agent cap reached (1 of 1)");
  assert.equal(creates(s.fake).length, 2);
});

test("PHCL-24 PHCL-10 collect: an archive failure keeps the agent counted live; the next block hits the cap", async () => {
  const s = setup({ overlay: { max_subagents: 1, max_live_subagents: 1 } });
  s.project.write("f.txt", "=== a\nA\n=== b\nB\n");
  s.fake.failNext("archiveAgent", new Error("archive down"));
  const r = await s.ph(["fanout", "--file", "f.txt", "--collect", "out"]);
  assertExit(r, 2);
  assertLine(r, /^collected a -> /);
  assertLine(r, /^failed archive a: .*archive down/);
  assertLine(r, "failed b: live agent cap reached (1 of 1)");
  assert.equal(creates(s.fake).length, 1);
});
