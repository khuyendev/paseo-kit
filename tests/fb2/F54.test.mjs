// F54 (kit feedback 54, 56): the resume gate breaks an owner tie in favour of the plan whose transfer record holds the
// path (the latest such record), and `gsd-flow.mjs adopt` re-hashes a transferred path after an owner's hand fix.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/02-sessions";
const SESSION = "lib/client/session";
const DAEMON = `${SESSION}/daemon_session.dart`;
const RELAY = `${SESSION}/relay.dart`;
const OWNS = [`Path:${SESSION}/`];
const PAST = new Date("2026-10-01T00:00:00Z");
const LATER = new Date("2026-10-02T00:00:00Z");
const sha = (text) => createHash("sha256").update(text).digest("hex");

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}

// Three plans own the same directory at the same depth; the session files are committed in the main tree.
const plan = (id, extra = {}) => ({ id, owns: OWNS, summary: `${PD}/${id}-SUMMARY.md`, complete: true, ...extra });
const threePlans = (extra = {}) => [plan("01-01", extra["01-01"]), plan("01-02", extra["01-02"]), plan("01-03", extra["01-03"])];

function sessionProject() {
  const p = makeTempProject({ files: { [DAEMON]: "d0\n", [RELAY]: "r0\n", [`${PD}/.keep`]: "" } });
  // Worktrees live outside the project, so the gate never sees them as untracked paths.
  const wt = (id) => {
    const dir = path.join(makeTempDir(), id);
    p.git("worktree", "add", "-q", "-b", `harness/${id}`, dir);
    return dir;
  };
  return { p, wt };
}

// A plan's worktree edits its files; the transfer copies them into the main tree and writes the plan's record (GSDF-94).
async function carry(p, wt, id, edits) {
  const dir = wt(id);
  for (const [rel, text] of Object.entries(edits)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  const r = await flow(p.root, ["transfer", PD], { plan: id, worktree: dir, owns: OWNS, summary: `${PD}/${id}-SUMMARY.md` });
  assert.equal(r.code, 0, JSON.stringify(r.json));
}

// Transfer records are ordered by their write time, so the test sets that time instead of relying on the clock.
const setRecordTime = (p, id, when) => fs.utimesSync(p.path(`${PD}/transfers/${id}.json`), when, when);

test("F54 kit-feedback 56: a tie between equally specific owners goes to the plan whose latest transfer record holds the path", async () => {
  const { p, wt } = sessionProject();
  assert.equal((await flow(p.root, ["baseline", PD])).code, 0);
  await carry(p, wt, "01-01", { [DAEMON]: "a1\n" });
  await carry(p, wt, "01-02", { [DAEMON]: "b1\n" });
  setRecordTime(p, "01-01", PAST);
  setRecordTime(p, "01-02", LATER);
  // The run's review fixer edits the transferred file in the main tree; no record holds the new content.
  p.write(DAEMON, "fix\n");
  const ok = await flow(p.root, ["resume-gate", PD], { plans: threePlans() });
  assert.deepEqual([ok.code, ok.json.problems], [0, []]);
  // The same edit, with 01-01 holding the latest record: the owner that holds it is 01-01, and it is incomplete.
  setRecordTime(p, "01-01", LATER);
  setRecordTime(p, "01-02", PAST);
  const late = await flow(p.root, ["resume-gate", PD], { plans: threePlans({ "01-01": { complete: false } }) });
  assert.deepEqual(late.json.problems, [{ kind: "incomplete plan changed", path: DAEMON, plan: "01-01" }]);
});

test("F54 a tie no transfer record breaks stays ambiguous", async () => {
  const { p, wt } = sessionProject();
  await flow(p.root, ["baseline", PD]);
  await carry(p, wt, "01-01", { [DAEMON]: "a1\n" });
  p.write(RELAY, "hand\n");
  const r = await flow(p.root, ["resume-gate", PD], { plans: threePlans() });
  assert.deepEqual(r.json.problems, [{ kind: "ambiguous owner", path: RELAY, plans: ["01-01", "01-02", "01-03"] }]);
});

test("F54 kit-feedback 54: after an owner's hand fix the gate accepts the tie, and adopt re-hashes only that path in the holder's record", async () => {
  const { p, wt } = sessionProject();
  await flow(p.root, ["baseline", PD]);
  await carry(p, wt, "01-01", { [DAEMON]: "a1\n", [RELAY]: "ra1\n" });
  const recordBefore = p.readJson(`${PD}/transfers/01-01.json`);
  p.write(DAEMON, "hand\n");
  const gate = await flow(p.root, ["resume-gate", PD], { plans: threePlans() });
  assert.deepEqual(gate.json.problems, []);

  const adopted = await flow(p.root, ["adopt", PD, "01-01", DAEMON]);
  assert.deepEqual([adopted.code, adopted.json], [0, { ok: true, plan: "01-01", path: DAEMON, adopted: true }]);
  const recordAfter = p.readJson(`${PD}/transfers/01-01.json`);
  assert.deepEqual(Object.fromEntries(recordAfter.files.map((f) => [f.path, f.sha256])), { [DAEMON]: sha("hand\n"), [RELAY]: sha("ra1\n") });
  assert.deepEqual({ ...recordAfter, files: null }, { ...recordBefore, files: null });

  const again = await flow(p.root, ["adopt", PD, "01-01", DAEMON]);
  assert.deepEqual(again.json, { ok: true, plan: "01-01", path: DAEMON, adopted: false });
});

test("F54 adopt refuses a path the plan's transfer did not carry, a plan without a record, an unfinished transfer and a malformed plan id", async () => {
  const { p, wt } = sessionProject();
  await flow(p.root, ["baseline", PD]);
  await carry(p, wt, "01-01", { [DAEMON]: "a1\n" });
  const notCarried = await flow(p.root, ["adopt", PD, "01-01", RELAY]);
  assert.deepEqual([notCarried.code, notCarried.json.reason], [1, "not in the plan's transfer record"]);
  const noRecord = await flow(p.root, ["adopt", PD, "01-02", DAEMON]);
  assert.equal(noRecord.code, 1);
  assert.equal(noRecord.json.status, "error");
  const malformed = await flow(p.root, ["adopt", PD, "../01-01", DAEMON]);
  assert.equal(malformed.code, 1);
  p.writeJson(`${PD}/transfers-pending/01-01.json`, { plan: "01-01", worktree: "wt", base: "b", paths: [DAEMON] });
  const pending = await flow(p.root, ["adopt", PD, "01-01", DAEMON]);
  assert.deepEqual([pending.code, /did not finish/.test(pending.json.reason)], [1, true]);
  assert.equal(p.readJson(`${PD}/transfers/01-01.json`).files.find((f) => f.path === DAEMON).sha256, sha("a1\n"));
});
