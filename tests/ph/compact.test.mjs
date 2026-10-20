import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { connectFake } from "../helpers/run.mjs";
import { armCompact, compactFiles, runCompactWatcher } from "../../ship/.agents/harness/runtime/compact.mjs";
import { loadConfig } from "../../ship/.agents/harness/config.mjs";
import { CALLER, setup } from "./setup.mjs";

function ctxFor(s, opts = {}) {
  const lines = [];
  return { lines, ctx: { env: s.env, root: s.root, cfg: loadConfig(s.root), clock: s.clock, opts, out: (l) => lines.push(l) } };
}

// A harmless detached sleeper stands in for the watcher: the real one would connect to a daemon.
const sleeperWatcher = (children) => ({ log }) => {
  const fd = fs.openSync(log, "w");
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { detached: true, windowsHide: true, stdio: ["ignore", fd, fd] });
  fs.closeSync(fd);
  children.push(child);
  return child.pid;
};

test("PHCL-17 arming: one watcher per agent, a dead lock pid is replaced, returns at once with the log path", async (t) => {
  const s = setup();
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  const children = [];
  t.after(() => children.forEach((c) => c.kill()));
  const { lock, log } = compactFiles(s.env, CALLER);
  const first = ctxFor(s);
  const started = Date.now();
  assert.equal(await armCompact(first.ctx, session, CALLER, { start: sleeperWatcher(children) }), 0);
  assert.ok(Date.now() - started < 2000);
  assert.match(first.lines[0], /^compact armed for c0ffee00 \(context n\/a\); it starts when the turn ends and the resume message follows when it is done \(log .*ph-compact-c0ffee00\.log\)\. End your turn now$/);
  assert.ok(fs.existsSync(log));
  assert.equal(Number(fs.readFileSync(lock, "utf8")), children[0].pid);
  await assert.rejects(armCompact(ctxFor(s).ctx, session, CALLER, { start: sleeperWatcher(children) }), new RegExp(`compact already armed for c0ffee00 \\(watcher pid ${children[0].pid}\\)`));
  assert.equal(children.length, 1);
  children[0].kill();
  await new Promise((resolve) => children[0].once("exit", resolve));
  assert.equal(await armCompact(ctxFor(s).ctx, session, CALLER, { start: sleeperWatcher(children) }), 0);
  assert.equal(children.length, 2);
});

test("PHCL-17 the resume text comes from --resume or config compact_resume; no autocompact setting is written", async () => {
  const s = setup({ overlay: { compact_resume: "Go on." } });
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  let args;
  const { ctx } = ctxFor(s);
  await armCompact(ctx, session, CALLER, { start: (spec) => ((args = spec.args), 999999) });
  assert.deepEqual(args, [CALLER, "--focus", "", "--resume", "Go on."]);
  fs.rmSync(compactFiles(s.env, CALLER).lock);
  await armCompact(ctxFor(s, { resume: "R", focus: "F" }).ctx, session, CALLER, { start: (spec) => ((args = spec.args), 999999) });
  assert.deepEqual(args, [CALLER, "--focus", "F", "--resume", "R"]);
  const source = fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness", "runtime", "compact.mjs"), "utf8");
  assert.ok(!/autoCompact|autocompact/i.test(source.replace(/Native autocompact is never touched/, "")));
});

async function watcherRun(after) {
  const s = setup();
  const target = s.fake.addAgent({ parent: CALLER, title: "me", lastUsage: { contextWindowUsedTokens: 400000 } });
  s.fake.setResponder((agent, text) => (text.startsWith("/compact") ? [{ reply: "", usage: { contextWindowUsedTokens: after } }] : [{ reply: "ok" }]));
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  const { lock } = compactFiles(s.env, target.id);
  fs.writeFileSync(lock, String(process.pid));
  const { ctx, lines } = ctxFor(s);
  const code = await runCompactWatcher(ctx, session, { target: target.id, focus: "keep the plan", resume: "Resume now." });
  const sent = s.fake.callsOf("sendAgentMessage").map((c) => c.args[1]);
  return { code, lines, sent, lockGone: !fs.existsSync(lock) };
}

test("PHCL-18 watcher: a large drop is confirmed and the resume text follows", async () => {
  const r = await watcherRun(20000);
  assert.equal(r.code, 0);
  assert.deepEqual(r.sent, ["/compact keep the plan", "Resume now."]);
  assert.ok(r.lines.some((l) => /^\d\d:\d\d:\d\d compaction done: used 400000 -> 20000$/.test(l)));
  assert.ok(r.lockGone);
});

test("PHCL-18 watcher: no drop gives the NOT-confirmed message, one /compact only", async () => {
  const r = await watcherRun(400000);
  assert.equal(r.code, 2);
  assert.equal(r.sent.filter((t) => t.startsWith("/compact")).length, 1);
  assert.equal(r.sent.at(-1), "compact-self: compaction NOT confirmed (used tokens 400000 -> 400000); it may have been cancelled by an incoming notification. Your context is probably not compacted. Decide yourself whether and when to call compact-self again.");
  assert.ok(r.lockGone);
});

test("PHCL-18 watcher: a turn that never ends sends no /compact", async () => {
  const s = setup({ overlay: { wait_timeout_s: 5 } });
  const target = s.fake.addAgent({ parent: CALLER, title: "me", status: "running" });
  const session = await connectFake(s.fake, { env: s.env, root: s.root, clock: s.clock });
  const pending = runCompactWatcher(ctxFor(s).ctx, session, { target: target.id, focus: "", resume: "R" });
  await s.clock.advance(6000);
  assert.equal(await pending, 2);
  const sent = s.fake.callsOf("sendAgentMessage").map((c) => c.args[1]);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /^compact-self: waiting for your turn to end failed, so \/compact was NOT sent/);
});
