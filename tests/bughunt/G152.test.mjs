// Bug-hunt fix G152 (2026-10-23 hunt): evolve-stats keeps the error of a failed run, names each stop reason in full,
// accepts only days that exist, records a run once, and skips a ledger line whose group is not an object.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { METRICS_REL, appendRecords, readLedger, runRecord } from "../../ship/.agents/harness/workflow/metrics.mjs";
import { setup } from "../workflow/helpers.mjs";

function fixtureRun(s, id, { status = "done", startedAt, error, stopReason, name = "code-wave" }) {
  const dir = s.project.path(`_workspace/_runs/${id}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ runId: id, name, status, startedAt, endedAt: startedAt.replace(":00.000Z", ":40.000Z"), error, stopReason }));
  fs.writeFileSync(path.join(dir, "journal.jsonl"), "");
}

const info = { name: "code-wave", status: "done", startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T10:00:40.000Z" };

test("G152 a failed run keeps its error in the ledger and names it on the workflow line", async () => {
  const s = setup();
  const error = "Paseo daemon disconnected while waiting for reviewer";
  fixtureRun(s, "wf_f1", { status: "failed", startedAt: "2026-10-20T10:00:00.000Z", error });
  const r = await s.ph(["evolve-stats", "--import"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(readLedger(s.project.root).records[0].error, error);
  assert.match(r.out.find((l) => l.startsWith("workflow code-wave")), /; failed: "Paseo daemon disconnected while waiting for reviewer" 1; median wall/);
});

test("G152 a failure error is capped in the ledger, as a stop reason is", () => {
  const rec = runRecord("wf_f2", { ...info, status: "failed", error: "x".repeat(500) }, [], null);
  assert.equal(rec.error.length, 300);
});

test("G152 stop reasons that share their first 60 characters stay separate, each named in full", async () => {
  const s = setup();
  const head = "owner stopped the workflow while the reviewer was still working on phase 3, ";
  fixtureRun(s, "wf_s1", { status: "stopped", startedAt: "2026-10-20T10:00:00.000Z", stopReason: `${head}Alice` });
  fixtureRun(s, "wf_s2", { status: "stopped", startedAt: "2026-10-21T10:00:00.000Z", stopReason: `${head}Bob` });
  fixtureRun(s, "wf_s3", { status: "stopped", startedAt: "2026-10-22T10:00:00.000Z" });
  const r = await s.ph(["evolve-stats", "--import"]);
  const line = r.out.find((l) => l.startsWith("workflow code-wave"));
  assert.match(line, new RegExp(`; stopped: "${head}Alice" 1, "${head}Bob" 1, no reason 1; `));
});

test("G152 --since takes a day that exists: 2026-02-31, 2026-02-29 of a common year and 2026-13-45 are usage errors", async () => {
  const s = setup();
  for (const since of ["2026-02-31", "2026-02-29", "2026-13-45", "2026-00-10"]) {
    const r = await s.ph(["evolve-stats", "--since", since]);
    assert.equal(r.code, 1, since);
    assert.match(r.err.join("\n"), /usage error: --since takes an ISO date \(YYYY-MM-DD\), got '/, since);
  }
  assert.equal((await s.ph(["evolve-stats", "--since", "2026-02-28"])).code, 0);
  assert.equal((await s.ph(["evolve-stats", "--since", "2028-02-29"])).code, 0, "a leap day is a day");
});

test("G152 a run is recorded once: a second append of its runId writes nothing", () => {
  const s = setup();
  const rec = runRecord("wf_d1", info, [], null);
  assert.equal(appendRecords(s.project.root, [rec]).length, 1);
  // The stop path, or a completion after an import read the ledger, appends the same run again.
  assert.equal(appendRecords(s.project.root, [{ ...rec, status: "failed" }]).length, 0);
  assert.deepEqual(readLedger(s.project.root).records.map((r) => r.status), ["done"]);
});

test("G152 a ledger line whose group is null is unreadable; the valid lines still report", async () => {
  const s = setup();
  fixtureRun(s, "wf_n1", { startedAt: "2026-10-20T10:00:00.000Z" });
  assert.equal((await s.ph(["evolve-stats", "--import"])).code, 0);
  fs.appendFileSync(path.join(s.project.root, METRICS_REL), `${JSON.stringify({ ...runRecord("wf_n2", info, [], null), groups: [null] })}\n`);
  const r = await s.ph(["evolve-stats"]);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.out.at(-1), `evolve-stats: 1 runs from ${METRICS_REL}, 1 unreadable lines skipped`);
});
