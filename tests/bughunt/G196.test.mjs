// Bug-hunt fix G196: the wave link cache also keys on size, and a SUMMARY, PLAN or run file over 1 MiB is not read.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const OFFICE = path.join(KIT_DIR, "plugins", "office");
const { WaveLinker, WAVE_FILE_MAX_BYTES } = await import(pathToFileURL(path.join(OFFICE, "server", "wave-link.ts")).href);

// Two PLANs in wave 1 and a SUMMARY for each; `summary` is the text of 02-02-SUMMARY.md.
function waveProject(summary = "---\nstatus: complete\n---\n") {
  const root = makeTempDir("bughunt G196 ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  for (const id of ["01", "02"]) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\nphase: 02\nplan: ${id}\nwave: 1\n---\n# plan\n`, "utf8");
  }
  fs.writeFileSync(path.join(dir, "02-01-SUMMARY.md"), "---\nstatus: complete\n---\n", "utf8");
  fs.writeFileSync(path.join(dir, "02-02-SUMMARY.md"), summary, "utf8");
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x", status: "running" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), JSON.stringify({ phaseDir: ".planning/phases/02-api", wave: 1 }), "utf8");
  return root;
}

test("G196 wave link: a SUMMARY rewritten with its old mtime is reparsed when its size changed", async () => {
  const root = waveProject();
  const summary = path.join(root, ".planning", "phases", "02-api", "02-02-SUMMARY.md");
  const w = new WaveLinker();
  assert.equal((await w.link(root, "wf_x")).plansDone, 2);

  // A whole-second mtime keeps the stat value exact, so the restored mtime matches the cached one.
  const stamp = new Date(Math.floor(Date.now() / 1000) * 1000 - 60_000);
  fs.utimesSync(summary, stamp, stamp);
  assert.equal((await w.link(root, "wf_x")).plansDone, 2);
  fs.writeFileSync(summary, "---\nstatus: halted\n---\n", "utf8");
  fs.utimesSync(summary, stamp, stamp);
  assert.equal(fs.statSync(summary).mtimeMs, stamp.getTime());
  assert.equal((await w.link(root, "wf_x")).plansDone, 1, "same mtime, new size: reparsed");
});

test("G196 wave link: a file over the read cap is unreadable, a file at the cap is read", async () => {
  const body = (size) => "---\nstatus: complete\n---\n" + "x".repeat(size);
  const head = "---\nstatus: complete\n---\n".length;

  const atCap = waveProject(body(WAVE_FILE_MAX_BYTES - head));
  assert.equal((await new WaveLinker().link(atCap, "wf_x")).scope, "complete");

  const overCap = waveProject(body(WAVE_FILE_MAX_BYTES - head + 1));
  assert.deepEqual(await new WaveLinker().link(overCap, "wf_x"), {
    phase: "02",
    wave: 1,
    plansDone: null,
    plansTotal: null,
    scope: "unreadable",
  });
});

test("G196 wave link: a run.json over the read cap gives no link", async () => {
  const root = waveProject();
  const run = path.join(root, "_workspace", "_runs", "wf_x", "run.json");
  fs.writeFileSync(run, JSON.stringify({ runId: "wf_x", pad: "x".repeat(WAVE_FILE_MAX_BYTES) }), "utf8");
  assert.equal(await new WaveLinker().link(root, "wf_x"), null);
});
