// Review rules after the Claude Code team's review write-up (owner decision 2026-10-22): pre-existing findings,
// one finding per defect class with its instances, and a second verifier for uncertain verdicts.
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "./host.mjs";
import { executor, makeExecWorld, task } from "./exec-world.mjs";
import { PHASE_DIR } from "./world.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const { diffHunks } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/flow-review.mjs")).href);
const PD = ".planning/phases/03-api";

async function flow(root, argv, input = "") {
  let line = "";
  const code = await main(argv, { root, input: typeof input === "string" ? input : JSON.stringify(input), out: (l) => { line = l; } });
  return { code, json: JSON.parse(line) };
}
const exec = (w, overrides = {}) => runScript("gsd-execute", { root: w.root, args: { phaseDir: PHASE_DIR }, gsd: w.gsd, agent: executor(w, overrides) });
const labels = (r) => r.calls.map((c) => c.opts.label);
const finding = (id, extra = {}) => ({ id, severity: "high", trigger: "empty input", likelihood: "likely", confidence: 90, impact: "crash", file: "src/01-01/impl.js", line: 20, description: `finding ${id}`, ...extra });
const thirty = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
const record = (w) => JSON.parse(w.read(`${PHASE_DIR}/review/w1-01-01.json`));

// A committed 30-line file whose plan rewrites only line 20, so lines far from 20 are pre-existing.
function seededWorld() {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  w.write("src/01-01/impl.js", `${thirty.join("\n")}\n`);
  w.git("add", "--", "src/01-01/impl.js");
  w.git("commit", "-q", "-m", "seed");
  const edit = {
    "exec-01-01": () => {
      const next = [...thirty];
      next[19] = "changed 20";
      w.write("src/01-01/impl.js", `${next.join("\n")}\n`);
      w.write(`${PHASE_DIR}/01-01-SUMMARY.md`, "---\nkey-files:\n  modified: [src/01-01/impl.js]\n---\ndone\n");
      return { taskResults: [{ task: "1", status: "implemented", evidence: "ok" }], deviations: [], requests: [] };
    },
  };
  return { w, edit };
}

test("REVW-01 diff hunks: new-side ranges, a one-line hunk and a pure deletion", () => {
  const diff = "@@ -3,2 +3,4 @@\n-a\n+b\n@@ -10 +12 @@\n-x\n+y\n@@ -20,3 +21,0 @@\n-z\n";
  assert.deepEqual(diffHunks(diff), [[3, 6], [12, 12], [21, 21]]);
  assert.deepEqual(diffHunks(""), []);
});

test("REVW-01 changed lines: uncommitted ranges, a new file is all, the plan's commit when clean, null without a change", async () => {
  const p = makeTempProject({ files: { "src/a/x.js": `${thirty.join("\n")}\n`, "src/a/y.js": "y\n" } });
  if (p.git("status", "--porcelain")) {
    p.git("add", "-A");
    p.git("commit", "-q", "-m", "seed");
  }
  const next = [...thirty];
  next[4] = "five";
  p.write("src/a/x.js", `${next.join("\n")}\n`);
  p.write("src/a/new.js", "n\n");
  let r = await flow(p.root, ["changed-lines", PD], { plan: "03-01", files: ["src/a/x.js", "src/a/new.js", "src/a/y.js"] });
  assert.equal(r.code, 0);
  assert.deepEqual(r.json.files, { "src/a/x.js": [[5, 5]], "src/a/new.js": "all", "src/a/y.js": null });
  p.git("add", "-A");
  p.git("commit", "-q", "-m", "plan 03-01");
  const sha = p.git("rev-parse", "HEAD");
  p.writeJson(`${PD}/commits.json`, [{ sha, phase: "03", wave: 1, plans: { "03-01": ["src/a/x.js", "src/a/new.js"] } }]);
  r = await flow(p.root, ["changed-lines", PD], { plan: "03-01", files: ["src/a/x.js", "src/a/y.js"] });
  assert.deepEqual(r.json.files, { "src/a/x.js": [[5, 5]], "src/a/y.js": null }, "a committed plan reads its own commit");
});

test("REVW-02 a finding outside the changed lines is pre-existing and deferred; near the change or caused by it, it is gated", async () => {
  const { w, edit } = seededWorld();
  const findings = { findings: [finding("OLD", { line: 3 }), finding("NEAR", { line: 22 }), finding("CAUSED", { line: 5, introduced: true }), finding("AT", { line: 20 })] };
  const r = await exec(w, { ...edit, "review-": () => findings });
  assert.equal(r.result.status, "executed");
  assert.deepEqual(record(w).findings.map((f) => [f.id, f.status]), [["OLD", "pre-existing"], ["NEAR", "gated"], ["CAUSED", "gated"], ["AT", "gated"]]);
  const review = r.calls.find((c) => c.opts.label === "review-01-01").prompt;
  assert.match(review, /Lines this plan changed:\n- src\/01-01\/impl\.js: 20/);
  assert.match(review, /introduced/);
  const verify = r.calls.find((c) => c.opts.label === "verify-findings-01-01").prompt;
  assert.doesNotMatch(verify, /"id":"OLD"/, "a pre-existing finding is never verified or fixed");
  assert.match(w.read(`${PHASE_DIR}/deferred.md`), /^- OLD \(high, pre-existing\) plan 01-01 src\/01-01\/impl\.js:3: finding OLD \[reason: outside the lines this plan changed \(pre-existing\)\]$/m);
  const metrics = JSON.parse(w.read("_workspace/review-metrics.jsonl").trim().split("\n").at(-1));
  assert.deepEqual([metrics.preExisting, metrics.deferred], [1, 1]);
});

test("REVW-02 a new file and an unknown change never make a finding pre-existing", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, { "review-": () => ({ findings: [finding("NEW", { line: 1 })] }) });
  assert.equal(r.result.status, "executed");
  assert.equal(record(w).findings[0].status, "gated");
  assert.match(r.calls.find((c) => c.opts.label === "review-01-01").prompt, /src\/01-01\/impl\.js: all \(new file\)/);
});

test("REVW-03 one finding per defect class: instances reach the verifier, the fixer and the resolution check", async () => {
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const instances = [{ file: "src/01-01/impl.js", line: 1 }, { file: "src/01-01/other.js", line: 4 }];
  const r = await exec(w, { "review-": () => ({ findings: [finding("CLS", { line: 1, class: "unchecked null", instances })] }) });
  assert.equal(r.result.status, "executed");
  const rec = record(w).findings[0];
  assert.deepEqual([rec.class, rec.instances], ["unchecked null", instances]);
  for (const label of ["verify-findings-01-01", "fix-review-w1", "resolve-01-01"]) {
    const prompt = r.calls.find((c) => c.opts.label === label)?.prompt ?? "";
    assert.match(prompt, /"class":"unchecked null"/, label);
    assert.match(prompt, /"instances":\[\{"file":"src\/01-01\/impl\.js","line":1\},\{"file":"src\/01-01\/other\.js","line":4\}\]/, label);
  }
  assert.match(r.calls.find((c) => c.opts.label === "fix-review-w1").prompt, /fixed at every instance/);
  assert.match(r.calls.find((c) => c.opts.label === "resolve-01-01").prompt, /resolved only when every instance is/);
  assert.match(r.calls.find((c) => c.opts.label === "review-01-01").prompt, /report it once|Report one defect once/i);
});

test("REVW-04 a second, independent verifier decides what the first left uncertain; still uncertain goes to the owner", async () => {
  const verdicts = (map) => (prompt) => ({ verdicts: [...prompt.matchAll(/"id":"([^"]+)"/g)].map((m) => ({ id: m[1], verdict: map[m[1]] ?? "confirmed", evidence: "e" })) });
  const findings = { findings: [finding("A", { line: 1 }), finding("B", { line: 1 }), finding("C", { line: 1 })] };
  const w = makeExecWorld({ waves: [[task("01-01")]] });
  const r = await exec(w, {
    "review-": () => findings,
    "verify-findings-01-01-second": verdicts({ A: "confirmed", B: "refuted" }),
    "verify-findings-01-01": verdicts({ A: "uncertain", B: "uncertain", C: "confirmed" }),
  });
  assert.equal(r.result.status, "executed");
  assert.deepEqual(record(w).findings.map((f) => [f.id, f.verdict]), [["A", "confirmed"], ["B", "refuted"], ["C", "confirmed"]]);
  const second = r.calls.find((c) => c.opts.label === "verify-findings-01-01-second").prompt;
  assert.match(second, /"id":"A"/);
  assert.doesNotMatch(second, /"id":"C"|"verdict"|"evidence"/, "only the undecided findings, without the first verdict");
  const metrics = JSON.parse(w.read("_workspace/review-metrics.jsonl").trim().split("\n").at(-1));
  assert.equal(metrics.secondVerifier, 2);

  const w2 = makeExecWorld({ waves: [[task("01-01")]] });
  const stuck = await exec(w2, { "review-": () => ({ findings: [finding("U", { line: 1 })] }), "verify-findings-01-01": verdicts({ U: "uncertain" }) });
  assert.deepEqual([stuck.result.status, stuck.result.stage], ["needs-owner", "Review"]);
  assert.equal(labels(stuck).filter((l) => l === "verify-findings-01-01-second").length, 1);
  assert.equal(record(w2).findings[0].verdict, "uncertain");
});
