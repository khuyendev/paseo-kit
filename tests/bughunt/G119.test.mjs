// Bug-hunt fix G119: two codebase-map runs cannot write and stamp the same documents, and a commit that lands during a
// map (an execute wave) stops the stamp instead of stamping a HEAD the mappers never read.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const LOCK = "_workspace/locks/codebase-map.lock";
const DOCS = { overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } };
const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const mapper = (w, extra = "") => (p, o) => {
  if (o.label.startsWith("review-")) return { issues: [] };
  const docs = FOCUS[o.label.replace("mapper-", "")];
  for (const d of docs) w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\n${d === "CONCERNS" ? extra : ""}`);
  return { focus: o.label, written: docs };
};
const map = (w, agent) => runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent });

test("G119 a second map on the same root is refused while the first holds the codebase-map lease; no mapper runs", async () => {
  const w = makeWorld(DOCS);
  w.write(LOCK, JSON.stringify({ runId: "wf_first", pid: process.pid, kind: "gsd-map-codebase" }));
  const r = await map(w, mapper(w));
  assert.deepEqual([r.result.status, r.calls.length], ["refused", 0]);
  assert.equal(r.result.reason, "a gsd-map-codebase run holds this code root (wf_first); map after it ends");
  assert.equal(w.read(".planning/codebase/STACK.md"), "");
});

test("G119 the codebase-map lease is released after a stamped map and after a map stopped at the secrets check", async () => {
  const w = makeWorld(DOCS);
  assert.equal((await map(w, mapper(w))).result.status, "mapped");
  assert.equal(fs.existsSync(path.join(w.root, LOCK)), false);
  const s = makeWorld(DOCS);
  assert.equal((await map(s, mapper(s, "aws AKIAABCDEFGHIJKLMNOP\n"))).result.status, "needs-owner");
  assert.equal(fs.existsSync(path.join(s.root, LOCK)), false);
});

test("G119 a commit that lands during the map stops the stamp: nothing is stamped or committed, the lease is released", async () => {
  const w = makeWorld(DOCS);
  const r = await map(w, (p, o) => {
    const reply = mapper(w)(p, o);
    if (o.label === "mapper-tech") spawnSync("git", ["commit", "-q", "--allow-empty", "-m", "execute wave"], { cwd: w.root });
    return reply;
  });
  assert.equal(r.result.status, "failed");
  assert.match(r.result.reason, /^HEAD moved during the map/);
  assert.equal(w.read(".planning/codebase/TESTING.md").includes("last_mapped_commit"), false);
  assert.equal(w.events.some((e) => e.startsWith("commit")), false);
  assert.equal(fs.existsSync(path.join(w.root, LOCK)), false);
});
