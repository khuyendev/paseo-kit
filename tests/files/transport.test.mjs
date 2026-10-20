import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PAGE_CHARS, pageResult, transport } from "../../ship/.agents/harness/files/backend.mjs";
import { PRIVATE, locked, sessionHash } from "../../ship/.agents/harness/files/private.mjs";
import { TOOLS } from "../../ship/.agents/harness/files/tools.mjs";
import { makeTempDir } from "../helpers/temp.mjs";
import { client, fixIds, scratch } from "./helpers.mjs";

const BACKEND = fileURLToPath(new URL("../../ship/.agents/harness/files/backend.mjs", import.meta.url));
const listing = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : null);

test("FTOL-02 schemas are flat objects with continuation and receipt", () => {
  for (const tool of TOOLS) {
    assert.equal(tool.inputSchema.type, "object");
    for (const k of ["anyOf", "oneOf", "allOf", "_meta"]) assert.equal(tool.inputSchema[k], undefined);
    assert.equal(tool._meta, undefined);
    assert.equal(tool.inputSchema.properties.continuation.type, "string");
    assert.equal(tool.inputSchema.properties.receipt.type, "string");
  }
});

test("FTOL-02 malformed arguments fail with field paths before any private state is written", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  const dir = path.join(c.stateRoot, sessionHash("session-a"));
  const cases = [
    ["edit_multiple_files", { files: [{ path: "f.txt", edits: [{ oldText: "", newText: "y" }] }] }, "edit_multiple_files.files[0].edits[0].oldText has an invalid string value"],
    ["write_multiple_files", {}, "write_multiple_files.files is required"],
    ["write_multiple_files", { files: [] }, "write_multiple_files.files must be a nonempty array"],
    ["read_ranges", { ranges: [{ path: "f.txt", from: 1.5 }] }, "read_ranges.ranges[0].from must be a valid integer"],
    ["read_ranges", { continuation: "XYZ" }, "read_ranges.continuation must be 64 lowercase hex characters"],
    ["read_ranges", { continuation: "a".repeat(64), path: "f.txt" }, "supply only continuation OR receipt, not base arguments or both"],
    ["read_ranges", { continuation: "a".repeat(64), receipt: "b".repeat(64) }, "supply only continuation OR receipt, not base arguments or both"],
  ];
  for (const [method, args, message] of cases) {
    assert.throws(() => c.stage(method, args), (e) => e.message === message, message);
    assert.equal(listing(dir), null);
  }
  assert.throws(() => transport({ action: "stage", session: "s", cwd: s.root, method: "read_file", args: {} }, c.opts), /unknown file tool read_file/);
});

test("FTOL-03 descriptions and every backend and mod message name only shipped tools", () => {
  const write = TOOLS.find((t) => t.name === "write_multiple_files");
  assert.equal(write.description, "Create or overwrite several files in one call (all-or-nothing: if any path is invalid, nothing is written). Parent directories are created. Supply operation arguments, or only continuation/receipt.");
  const banned = /\b(read_media_file|read_file|read_text_file|read_multiple_files|write_file|edit_file|fsbatch|filesystem)\b/;
  const dir = path.dirname(BACKEND);
  const sources = [...fs.readdirSync(dir).map((n) => path.join(dir, n)), fileURLToPath(new URL("../../ship/.claude/plugins/harness-files/hooks/register.ts", import.meta.url)),
    fileURLToPath(new URL("../../ship/.claude/plugins/harness-files/scripts/discover.mjs", import.meta.url))];
  for (const file of sources) assert.doesNotMatch(fs.readFileSync(file, "utf8"), banned, file);
  assert.doesNotMatch(JSON.stringify(TOOLS), banned);
});

test("FTOL-08 the plan lists canonical targets, parent folders and each missing ancestor", () => {
  const s = scratch({ "exists/e.txt": "e" });
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", { files: [{ path: "new/dir/f.txt", content: "x" }] });
  const checks = c.plan(stage);
  const writes = checks.filter((ch) => ch.tool === "Write").map((ch) => [ch.input.file_path, ch.input.content]);
  assert.ok(writes.some(([p, cn]) => p === s.path("new/dir/f.txt") && cn === "x"));
  assert.ok(writes.some(([p, cn]) => p === s.path("new/dir") && cn === ""));
  assert.ok(writes.some(([p, cn]) => p === s.path("new") && cn === ""));
  assert.ok(writes.some(([p]) => p === s.root));
  const e = c.plan(c.stage("edit_multiple_files", { files: [{ path: "exists/e.txt", edits: [{ oldText: "e", newText: "E" }] }] }));
  assert.ok(e.some((ch) => ch.tool === "Edit" && ch.input.old_string === "e" && ch.input.new_string === "E"));
  assert.ok(e.some((ch) => ch.tool === "Write" && ch.input.file_path === s.path("exists") && ch.input.content === ""));
});

test("FTOL-09 a link repointed between plan and execute aborts with plan changed", () => {
  const s = scratch({ "t1/a": "one", "t2/a": "two" });
  fs.symlinkSync(s.path("t1"), s.path("link"), "junction");
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", { files: [{ path: "link/a", content: "changed" }] });
  c.plan(stage);
  fs.rmSync(s.path("link"));
  fs.symlinkSync(s.path("t2"), s.path("link"), "junction");
  c.execute(stage);
  assert.match(c.collect(stage.ticket).text, /permission plan changed \(paths, symlinks or retained fixes\); nothing executed, retry the call/);
  assert.equal(s.read("t1/a"), "one");
  assert.equal(s.read("t2/a"), "two");
});

test("FTOL-09 a broken symlink fails the plan", { skip: process.platform === "win32" }, () => {
  const s = scratch();
  fs.symlinkSync(s.path("nowhere"), s.path("dangling"));
  const c = client({ cwd: s.root });
  assert.throws(() => c.plan(c.stage("write_multiple_files", { files: [{ path: "dangling/x", content: "x" }] })), /broken symlink/);
});

test("FTOL-11 a ticket executes at most once; withdrawn tickets never run; receipts do not rerun", () => {
  const s = scratch({ "f.txt": "v1" });
  const c = client({ cwd: s.root });
  const stage = c.stage("write_multiple_files", { files: [{ path: "f.txt", content: "v2" }] });
  c.plan(stage);
  c.execute(stage);
  s.write("f.txt", "reset");
  c.execute(stage);
  assert.equal(s.read("f.txt"), "reset");
  assert.match(c.collect(stage.ticket).text, /^wrote/);
  const receipt = c.call("write_multiple_files", { receipt: stage.ticket });
  assert.match(receipt.text, /^wrote/);
  assert.equal(s.read("f.txt"), "reset");
  assert.throws(() => c.stage("read_ranges", { receipt: stage.ticket }), /receipt belongs to a different tool/);
  const w = c.stage("write_multiple_files", { files: [{ path: "f.txt", content: "never" }] });
  c.plan(w);
  assert.deepEqual(c.abandon(w.ticket), { started: false });
  assert.throws(() => c.execute(w), /execution ticket unknown or withdrawn; nothing executed/);
  assert.equal(s.read("f.txt"), "reset");
  const u = c.stage("write_multiple_files", { files: [{ path: "f.txt", content: "u" }] });
  c.plan(u);
  fs.writeFileSync(path.join(c.stateRoot, u.session, `${u.ticket}.started`), "1");
  assert.throws(() => c.execute(u), /execution ticket already started; outcome unknown, recover receipt or inspect targets; operation will not repeat/);
  assert.deepEqual(c.abandon(u.ticket), { started: true });
});

test("FTOL-13 a 90,000-char report with an emoji at a page boundary reassembles identically", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  const text = "a".repeat(PAGE_CHARS - 1) + "😀" + "b".repeat(50000);
  c.call("read_ranges", { ranges: [{ path: "f.txt" }] }); // creates the session directory
  const dir = path.join(c.stateRoot, sessionHash("session-a"));
  const pages = [pageResult(dir, "edit_multiple_files", { isError: true, text }).text];
  for (let m; (m = /CONTINUATION ([a-f0-9]{64}): call mcp__harness-files__edit_multiple_files with \{"continuation":"\1"\}/.exec(pages.at(-1))); ) {
    if (pages.length === 1) assert.throws(() => c.stage("read_ranges", { continuation: m[1] }), /continuation belongs to a different tool/);
    pages.push(c.call("edit_multiple_files", { continuation: m[1] }).text);
  }
  assert.equal(pages.length, 3);
  for (const p of pages) {
    assert.ok(p.length <= 44000, String(p.length));
    assert.ok(p.startsWith("ERROR (details/fix IDs are paginated, not discarded)\n"));
  }
  const body = pages.map((p) => p.replace(/^ERROR \(details\/fix IDs are paginated, not discarded\)\n/, "").replace(/\n\nCONTINUATION [\s\S]*$/, "")).join("");
  assert.equal(body, text);
  assert.throws(() => c.stage("read_ranges", { continuation: "c".repeat(64) }), /continuation unknown or expired \(one-hour private retention\/budget\); read the needed range again/);
});

test("FTOL-13 a long report pages losslessly, fix IDs persisted before paging", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  const edits = Array.from({ length: 600 }, (_, i) => ({ oldText: `nothing ${i} q`, newText: "z" }));
  const first = c.call("edit_multiple_files", { files: [{ path: "f.txt", edits }] });
  const all = [first.text];
  for (let m; (m = /CONTINUATION ([a-f0-9]{64})/.exec(all.at(-1))); ) all.push(c.call("edit_multiple_files", { continuation: m[1] }).text);
  const text = all.map((p) => p.replace(/^ERROR \(details\/fix IDs are paginated, not discarded\)\n/, "").replace(/\n\nCONTINUATION [\s\S]*$/, "")).join("");
  assert.equal(fixIds(text).length, 600);
  assert.ok(all.every((p) => p.length <= 44000));
  const other = client({ cwd: s.root, session: "s2", stateRoot: c.stateRoot });
  assert.throws(() => other.stage("edit_multiple_files", { continuation: /CONTINUATION ([a-f0-9]{64})/.exec(first.text)?.[1] ?? "d".repeat(64) }), /continuation unknown or expired/);
});

test("FTOL-14 state is per session; fix IDs of session A are unknown in B; unsafe state directories are refused", () => {
  const s = scratch({ "f.txt": "x" });
  const a = client({ cwd: s.root });
  const r = a.call("edit_multiple_files", { files: [{ path: "f.txt", edits: [{ oldText: "absent", newText: "y" }] }] });
  const [id] = fixIds(r.text.split("failed:\n")[1]);
  const b = client({ cwd: s.root, session: "session-b", stateRoot: a.stateRoot });
  assert.match(b.call("edit_multiple_files", { fixes: [{ id }] }).text, /unknown fix id/);
  const root = makeTempDir("paseo kit state ");
  const target = makeTempDir("paseo kit elsewhere ");
  fs.symlinkSync(target, path.join(root, sessionHash("linked")), "junction");
  assert.throws(() => transport({ action: "stage", session: "linked", cwd: s.root, method: "read_ranges", args: { ranges: [{ path: "f.txt" }] } }, { stateRoot: root }), /unsafe private state directory/);
});

test("FTOL-15 dead-pid and unwritten stale locks are recovered; a live lock fails after the wait", () => {
  const dir = makeTempDir("paseo kit lock ");
  const lock = path.join(dir, "session.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: 2 ** 31 - 2 }));
  assert.equal(locked(dir, () => "ran"), "ran");
  fs.writeFileSync(lock, "");
  const old = new Date(Date.now() - PRIVATE.lockUnwrittenMs - 1000);
  fs.utimesSync(lock, old, old);
  assert.equal(locked(dir, () => "ran"), "ran");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid }));
  const start = Date.now();
  assert.throws(() => locked(dir, () => "no", { lockWaitMs: 300 }), /private session state locked by another running file operation; retry later/);
  assert.ok(Date.now() - start >= 300);
  assert.equal(PRIVATE.lockWaitMs, 20000);
  fs.rmSync(lock);
});

test("FTOL-15 a killed execute does not wedge the session; 8 concurrent executes give 8 distinct fix IDs", async () => {
  const s = scratch({ "f.txt": "x" });
  const tmp = makeTempDir("paseo kit tmp ");
  const env = { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp };
  delete env.PASEO_HARNESS_ROOT;
  const stateRoot = path.join(tmp, `paseo-harness-files-${process.getuid?.() ?? "user"}`);
  const c = client({ cwd: s.root, stateRoot });
  const stages = Array.from({ length: 8 }, (_, i) => c.stage("edit_multiple_files", { files: [{ path: "f.txt", edits: [{ oldText: `absent ${i}`, newText: "y" }] }] }));
  for (const st of stages) c.plan(st);
  const kill = c.stage("read_ranges", { ranges: [{ path: "f.txt" }] });
  c.plan(kill);
  const killed = spawn(process.execPath, [BACKEND, "--execute", kill.session, kill.ticket], { env });
  killed.kill("SIGKILL");
  await new Promise((resolve) => killed.on("exit", resolve));
  const runs = stages.map((st) => new Promise((resolve) => {
    const child = spawn(process.execPath, [BACKEND, "--execute", st.session, st.ticket], { env });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.on("exit", (code) => resolve({ code, out }));
  }));
  const results = await Promise.all(runs);
  for (const r of results) {
    assert.equal(r.code, 0);
    assert.match(r.out, /harness-files ticket completed/);
  }
  const ids = stages.map((st) => fixIds(c.collect(st.ticket).text.split("failed:\n")[1])[0]);
  assert.equal(new Set(ids).size, 8);
});

test("FTOL-16 expired tickets are swept, unfinished tickets hit the budget, stale sessions are removed", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  const st = c.stage("read_ranges", { ranges: [{ path: "f.txt" }] });
  const req = path.join(c.stateRoot, st.session, `${st.ticket}.request.json`);
  const old = new Date(Date.now() - PRIVATE.ticketMs - 1);
  fs.utimesSync(req, old, old);
  c.call("read_ranges", { ranges: [{ path: "f.txt" }] });
  assert.equal(fs.existsSync(req), false);
  const stale = path.join(c.stateRoot, sessionHash("old-session"));
  fs.mkdirSync(stale);
  const day = new Date(Date.now() - 25 * 3600000);
  fs.utimesSync(stale, day, day);
  c.call("read_ranges", { ranges: [{ path: "f.txt" }] });
  assert.equal(fs.existsSync(stale), false);
  const dir = path.join(c.stateRoot, st.session);
  for (let i = 0; i < PRIVATE.budgetFiles; i++) fs.writeFileSync(path.join(dir, `${i.toString(16).padStart(64, "0")}.request.json`), "{}");
  assert.throws(() => c.stage("read_ranges", { ranges: [{ path: "f.txt" }] }), /private session transport budget reached by unfinished tickets/);
  for (const n of fs.readdirSync(dir)) if (n.endsWith(".request.json")) fs.rmSync(path.join(dir, n));
  for (let i = 0; i < PRIVATE.budgetFiles; i++) fs.writeFileSync(path.join(dir, `${i.toString(16).padStart(64, "0")}.result.json`), "{}");
  assert.ok(c.stage("read_ranges", { ranges: [{ path: "f.txt" }] }).ticket);
});

test("FTOL-06 the backend answers protocol 1 on stdin and refuses requests over 16 MiB", () => {
  const ok = spawnSync(process.execPath, [BACKEND], { input: JSON.stringify({ action: "describe" }), encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  const reply = JSON.parse(ok.stdout);
  assert.equal(reply.protocol, 1);
  assert.deepEqual(reply.tools.map((t) => t.name), ["read_ranges", "edit_multiple_files", "write_multiple_files"]);
  const big = spawnSync(process.execPath, [BACKEND], { input: "x".repeat(16 * 1024 * 1024 + 1), encoding: "utf8" });
  assert.equal(big.status, 1);
  assert.match(big.stderr, /file request exceeds 16 MiB; split the call/);
  const bad = spawnSync(process.execPath, [BACKEND, "--plan", "zz", "1".repeat(64)], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /invalid backend ticket/);
});

test("FTOL-07 the native ticket command quotes a backend path with spaces and a quote, and runs", (t) => {
  const bash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" });
  if (bash.status !== 0) return t.skip("bash not available");
  const project = path.join(makeTempDir("paseo kit "), "it's here");
  fs.cpSync(path.join(path.dirname(BACKEND), ".."), path.join(project, ".agents", "harness"), { recursive: true });
  fs.copyFileSync(fileURLToPath(new URL("../../ship/.agents/harness.defaults.json", import.meta.url)), path.join(project, ".agents", "harness.defaults.json"));
  fs.writeFileSync(path.join(project, "f.txt"), "hi");
  const tmp = makeTempDir("paseo kit tmp ");
  const stateRoot = path.join(tmp, `paseo-harness-files-${process.getuid?.() ?? "user"}`);
  const backend = path.join(project, ".agents", "harness", "files", "backend.mjs");
  const quoted = `'${backend.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
  const st = transport({ action: "stage", session: "q", cwd: project, method: "write_multiple_files", args: { files: [{ path: "f.txt", content: "z".repeat(100000) }] } }, { stateRoot });
  const small = transport({ action: "stage", session: "q", cwd: project, method: "write_multiple_files", args: { files: [{ path: "f.txt", content: "tiny" }] } }, { stateRoot });
  const env = { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp };
  delete env.PASEO_HARNESS_ROOT;
  for (const action of ["--plan", "--execute"]) {
    const command = `node ${quoted} ${action} ${st.session} ${st.ticket}`;
    assert.equal(command.length, `node ${quoted} ${action} ${small.session} ${small.ticket}`.length);
    assert.ok(command.length <= quoted.length + 200);
    const r = spawnSync("bash", ["-c", command], { env, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /harness-files ticket completed/);
  }
  assert.equal(fs.readFileSync(path.join(project, "f.txt"), "utf8").length, 100000);
});

test("FTOL-09 during execution a target outside the checked set fails as unplanned", async () => {
  const { executeRequest, planRequest } = await import("../../ship/.agents/harness/files/plan.mjs");
  const { createStore } = await import("../../ship/.agents/harness/files/store.mjs");
  const s = scratch({ "a.txt": "a", "b.txt": "b" });
  const request = { cwd: s.root, method: "read_ranges", args: { ranges: [{ path: "a.txt" }, { path: "b.txt" }] } };
  const store = createStore();
  const plan = planRequest(request, store);
  const narrowed = { signature: plan.signature, checks: plan.checks.filter((c) => !c.abs.endsWith("b.txt")) };
  const out = executeRequest(request, store, narrowed, {});
  assert.match(out.text, /ERROR b\.txt: unplanned or changed target: .*b\.txt; nothing authorized for this path/);
  assert.match(out.text, /1\| a/);
});

test("FTOL-02 an edit with newText alone is refused with its field path before staging (CR-FIL-04)", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  assert.throws(() => c.stage("edit_multiple_files", { files: [{ path: "f.txt", edits: [{ oldText: "x", newText: "y" }, { newText: "y" }] }] }),
    (e) => e.message === "edit_multiple_files.files[0].edits[1] needs oldText, or from/to or after with the file entry's tag");
  assert.equal(listing(path.join(c.stateRoot, sessionHash("session-a"))), null);
});

test("FTOL-13 a continuation whose reply was lost gives the same page and next token again (CR-FIL-06)", () => {
  const s = scratch({ "f.txt": "x" });
  const c = client({ cwd: s.root });
  c.call("read_ranges", { ranges: [{ path: "f.txt" }] });
  const dir = path.join(c.stateRoot, sessionHash("session-a"));
  const text = "A".repeat(PAGE_CHARS) + "B".repeat(PAGE_CHARS) + "C".repeat(10000);
  const token = (page) => /CONTINUATION ([a-f0-9]{64})/.exec(page)?.[1];
  const first = token(pageResult(dir, "edit_multiple_files", { text }).text);
  c.stage("edit_multiple_files", { continuation: first }); // stage reply lost: its result ticket never reaches the mod
  const b1 = c.call("edit_multiple_files", { continuation: first }).text;
  const b2 = c.call("edit_multiple_files", { continuation: first }).text; // collected reply lost: asked again
  assert.equal(b1, b2);
  assert.ok(b1.startsWith("B".repeat(PAGE_CHARS)));
  const last = token(b1);
  const c1 = c.call("edit_multiple_files", { continuation: last }).text;
  assert.equal(c.call("edit_multiple_files", { continuation: last }).text, c1);
  assert.equal(c1, "C".repeat(10000));
});
