import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { RotateResolver } from "../../plugins/swarm-map/server/rotate.ts";
import { WaveLinker, frontmatterScalar } from "../../plugins/swarm-map/server/wave-link.ts";
import { installRuntime, KIT_DIR, makeTempDir, SHIP_DIR } from "../helpers/temp.mjs";

function setDefaultsPct(defaultsFile, pct) {
  const d = JSON.parse(fs.readFileSync(defaultsFile, "utf8"));
  d.context_guard = { ...d.context_guard, start_pct: pct };
  fs.writeFileSync(defaultsFile, JSON.stringify(d, null, 2), "utf8");
}

function project(installedPct, overlayPct) {
  const root = makeTempDir("ui rotate project ");
  installRuntime(root);
  fs.writeFileSync(path.join(root, ".agents", "harness-kit.json"), JSON.stringify({ version: "0.1.0" }), "utf8");
  setDefaultsPct(path.join(root, ".agents", "harness.defaults.json"), installedPct);
  if (overlayPct !== undefined) fs.writeFileSync(path.join(root, ".agents", "harness.config.json"), JSON.stringify({ context_guard: { window_tokens: 1000000, start_pct: overlayPct, step_pct: 5 } }), "utf8");
  fs.mkdirSync(path.join(root, "src", "deep"), { recursive: true });
  return root;
}

test("PANL-55 rotatePct per agent equals the project's effective context_guard.start_pct", async () => {
  const kit = makeTempDir("ui source kit ");
  fs.cpSync(path.join(SHIP_DIR, ".agents", "harness"), path.join(kit, ".agents", "harness"), { recursive: true });
  fs.copyFileSync(path.join(SHIP_DIR, ".agents", "harness.defaults.json"), path.join(kit, ".agents", "harness.defaults.json"));
  setDefaultsPct(path.join(kit, ".agents", "harness.defaults.json"), 91);
  const p1 = project(70, 55);
  const p2 = project(75, 80);
  const p3 = project(65);
  const outside = makeTempDir("ui not a kit project ");
  const r = new RotateResolver(path.join(kit, ".agents", "harness", "config.mjs"));
  const expected = async (root) => (await import(pathToFileURL(path.join(root, ".agents", "harness", "config.mjs")).href)).loadConfig(root).context_guard.start_pct;
  assert.equal(await r.forCwd(path.join(p1, "src", "deep"), 0), await expected(p1));
  assert.equal(await r.forCwd(p1, 0), 55);
  assert.equal(await r.forCwd(p2, 0), 80);
  assert.equal(await r.forCwd(p3, 0), 65);
  assert.equal(await r.forCwd(outside, 0), 91);
  assert.equal(await r.forCwd(null, 0), 91);
  assert.deepEqual(r.drainErrors(), []);
  const broken = new RotateResolver(path.join(kit, "missing.mjs"));
  assert.equal(await broken.forCwd(p1, 0), null);
  assert.equal(broken.drainErrors().length, 1);
});

test("PANL-55 no threshold constant in the swarm map", () => {
  const dir = path.join(KIT_DIR, "plugins", "swarm-map");
  for (const sub of ["client", "server", "shared"]) {
    if (!fs.existsSync(path.join(dir, sub))) continue;
    for (const f of fs.readdirSync(path.join(dir, sub), { recursive: true })) {
      const text = fs.readFileSync(path.join(dir, sub, f), "utf8");
      assert.doesNotMatch(text, /ROTATE_PCT|rotatePct\s*[:=]\s*\d/, f);
    }
  }
});

function waveProject(plans) {
  const root = makeTempDir("ui wave project ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, wave, summary] of plans) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\r\nphase: 02\r\nplan: ${id}\r\nwave: ${wave}\r\n---\r\n# plan\r\n`, "utf8");
    if (summary) fs.writeFileSync(path.join(dir, `02-${id}-SUMMARY.md`), `---\nstatus: ${summary}\n---\n`, "utf8");
  }
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x", status: "running" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), "﻿" + JSON.stringify({ phaseDir: ".planning/phases/02-api", wave: 1 }), "utf8");
  return root;
}

test("PANL-61 a harness.run group links to its phase wave progress; unlinked otherwise", async () => {
  const root = waveProject([["01", 1, "complete"], ["02", 1, "complete"], ["03", 1, null], ["04", 1, "halted"], ["05", 2, "complete"]]);
  const w = new WaveLinker();
  assert.deepEqual(await w.link(root, "wf_x"), { phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete" });
  assert.equal(await w.link(root, null), null);
  assert.equal(await w.link(root, "wf_missing"), null);
  assert.equal(await w.link(null, "wf_x"), null);
  fs.writeFileSync(path.join(root, "_workspace", "_runs", "wf_x", "args.json"), JSON.stringify({ phaseDir: "../outside" }), "utf8");
  assert.equal(await w.link(root, "wf_x"), null, "phaseDir outside .planning/phases is no link");
  assert.equal(frontmatterScalar("---\nwave: '3' # c\n---\n", "wave"), "3");
});
