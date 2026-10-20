import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { RotateResolver } from "../../plugins/swarm-map/server/rotate.ts";
import { WaveLinker } from "../../plugins/swarm-map/server/wave-link.ts";
import { installRuntime, KIT_DIR, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

const SHIP_DEFAULTS = path.join(SHIP_DIR, ".agents", "harness.defaults.json");

function setDefaultsPct(defaultsFile, pct) {
  const d = JSON.parse(fs.readFileSync(defaultsFile, "utf8"));
  d.context_guard = { ...d.context_guard, start_pct: pct };
  fs.writeFileSync(defaultsFile, JSON.stringify(d, null, 2), "utf8");
}

function project(installedPct, overlay) {
  const root = makeTempDir("ui rotate project ");
  installRuntime(root);
  fs.writeFileSync(path.join(root, ".agents", "harness-kit.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
  setDefaultsPct(path.join(root, ".agents", "harness.defaults.json"), installedPct);
  if (overlay !== undefined) fs.writeFileSync(path.join(root, ".agents", "harness.config.json"), typeof overlay === "string" ? overlay : JSON.stringify(overlay), "utf8");
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  return root;
}

const guard = (pct) => ({ context_guard: { window_tokens: 1000000, start_pct: pct, step_pct: 5 } });

test("PANL-55 rotatePct per agent equals the project's effective context_guard.start_pct", async () => {
  const sourceKit = JSON.parse(fs.readFileSync(SHIP_DEFAULTS, "utf8"));
  sourceKit.context_guard.start_pct = 91;
  const p1 = project(70, guard(55));
  const p2 = project(75, guard(80));
  const p3 = project(65);
  const p4 = project(66, "{ not json");
  const p5 = project(67, { context_guard: { step_pct: 7 } });
  const outside = makeTempDir("ui not a kit project ");
  const r = new RotateResolver(sourceKit);
  const expected = async (root) => (await import(pathToFileURL(path.join(root, ".agents", "harness", "config.mjs")).href)).loadConfigLenient(root).cfg.context_guard.start_pct;
  for (const root of [p1, p2, p3, p4, p5]) assert.equal(await r.forCwd(path.join(root, "src", "deep"), 0), await expected(root), root);
  assert.deepEqual([await r.forCwd(p1, 0), await r.forCwd(p2, 0), await r.forCwd(p3, 0), await r.forCwd(p4, 0), await r.forCwd(p5, 0)], [55, 80, 65, 66, 67]);
  assert.equal(await r.forCwd(outside, 0), 91);
  assert.equal(await r.forCwd(null, 0), 91);
  assert.deepEqual(r.drainErrors(), []);
  const broken = new RotateResolver({ context_guard: {} });
  assert.equal(await broken.forCwd(null, 0), null);
  assert.equal(broken.drainErrors().length, 1);
});

test("PANL-55 the bundled kit defaults equal ship/.agents/harness.defaults.json", () => {
  const bundled = path.join(KIT_DIR, "plugins", "swarm-map", "server", "kit-defaults.json");
  const norm = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  assert.equal(norm(bundled), norm(SHIP_DEFAULTS), "copy ship/.agents/harness.defaults.json to plugins/swarm-map/server/kit-defaults.json");
});

test("PANL-55 rotate never imports the project's modules (CR-PNL-02)", async () => {
  const root = project(70, guard(55));
  const sentinel = `__ui_rotate_${process.pid}`;
  fs.writeFileSync(path.join(root, ".agents", "harness", "config.mjs"), `globalThis.${sentinel} = true;\nexport const loadConfigLenient = () => ({ cfg: { context_guard: { start_pct: 1 } } });\n`, "utf8");
  assert.equal(await new RotateResolver().forCwd(root, 0), 55);
  assert.equal(globalThis[sentinel], undefined);
});

test("PANL-55 no threshold constant in the swarm map", () => {
  const dir = path.join(KIT_DIR, "plugins", "swarm-map");
  for (const sub of ["client", "server", "shared"]) {
    if (!fs.existsSync(path.join(dir, sub))) continue;
    for (const f of fs.readdirSync(path.join(dir, sub), { recursive: true })) {
      if (String(f).endsWith(".json")) continue;
      const text = fs.readFileSync(path.join(dir, sub, f), "utf8");
      assert.doesNotMatch(text, /ROTATE_PCT|rotatePct\s*[:=]\s*\d|start_pct\s*[:=]\s*\d/, f);
    }
  }
});

function waveProject(plans) {
  const root = makeTempDir("ui wave project ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, wave, summary] of plans) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\r\nphase: 02\r\nplan: ${id}\r\nwave: ${wave}\r\n---\r\n# plan\r\n`, "utf8");
    if (summary !== undefined && summary !== false) fs.writeFileSync(path.join(dir, `02-${id}-SUMMARY.md`), summary.startsWith("---") ? summary : `---\nstatus: ${summary}\n---\n`, "utf8");
  }
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x", status: "running" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), "﻿" + JSON.stringify({ phaseDir: ".planning/phases/02-api", wave: 1 }), "utf8");
  return root;
}

test("PANL-61 a harness.run group links to its phase wave progress; unlinked otherwise", async () => {
  const root = waveProject([["01", 1, "complete"], ["02", 1, "complete"], ["03", 1, false], ["04", 1, "halted"], ["05", 2, "complete"], ["06", 1, "---\nphase: 02\n---\n"]]);
  const w = new WaveLinker();
  assert.deepEqual(await w.link(root, "wf_x"), { phase: "02", wave: 1, plansDone: 3, plansTotal: 5, scope: "complete" });
  assert.equal(await w.link(root, null), null);
  assert.equal(await w.link(root, "wf_missing"), null);
  assert.equal(await w.link(null, "wf_x"), null);
  fs.writeFileSync(path.join(root, "_workspace", "_runs", "wf_x", "args.json"), JSON.stringify({ phaseDir: "../outside" }), "utf8");
  assert.equal(await w.link(root, "wf_x"), null, "phaseDir outside .planning/phases is no link");
});

test("PANL-61 an unfinished, malformed or unreadable SUMMARY withholds the counts (CR-PNL-06)", async () => {
  const unreadable = { phase: "02", wave: 1, plansDone: null, plansTotal: null, scope: "unreadable" };
  for (const bad of ["---\nstatus: complete\n", "---\nstatus: [halted\n---\n"]) {
    const root = waveProject([["01", 1, "complete"], ["02", 1, bad]]);
    assert.deepEqual(await new WaveLinker().link(root, "wf_x"), unreadable, JSON.stringify(bad));
  }
  const root = waveProject([["01", 1, "complete"], ["02", 1, false]]);
  fs.mkdirSync(path.join(root, ".planning", "phases", "02-api", "02-02-SUMMARY.md"));
  assert.deepEqual(await new WaveLinker().link(root, "wf_x"), unreadable, "a SUMMARY that cannot be read is not absent");
});

test("PANL-61 junctions out of the project are never followed (CR-PNL-11)", async () => {
  const outside = waveProject([["01", 1, "complete"], ["02", 1, "complete"]]);
  const external = path.join(outside, ".planning", "phases", "02-api");
  const w = new WaveLinker();

  const linkedPhase = waveProject([]);
  fs.rmSync(path.join(linkedPhase, ".planning", "phases", "02-api"), { recursive: true });
  fs.symlinkSync(external, path.join(linkedPhase, ".planning", "phases", "02-api"), "junction");
  assert.equal(await w.link(linkedPhase, "wf_x"), null, "linked phase directory");

  const linkedRun = waveProject([["01", 1, "complete"]]);
  fs.rmSync(path.join(linkedRun, "_workspace", "_runs", "wf_x"), { recursive: true });
  fs.symlinkSync(path.join(outside, "_workspace", "_runs", "wf_x"), path.join(linkedRun, "_workspace", "_runs", "wf_x"), "junction");
  assert.equal(await w.link(linkedRun, "wf_x"), null, "linked run directory");

  const linkedFile = waveProject([["01", 1, "complete"], ["02", 1, false]]);
  const target = path.join(linkedFile, ".planning", "phases", "02-api", "02-02-SUMMARY.md");
  try {
    fs.symlinkSync(path.join(external, "02-02-SUMMARY.md"), target, "file");
  } catch {
    return; // file symlinks need a privilege on Windows; the directory cases above still ran
  }
  const r = await w.link(linkedFile, "wf_x");
  assert.equal(r.scope, "unreadable", "a SUMMARY linked from outside is not read");
});
