// OFFC-03 / OFFC-18: the office wave link (migrated PANL-61 fixtures), its containment, bounds and the only-reader gate.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";

const OFFICE = path.join(KIT_DIR, "plugins", "office");
const load = (...parts) => import(pathToFileURL(path.join(OFFICE, ...parts)).href);
const { WaveLinker, WAVE_PLANS_MAX } = await load("server", "wave-link.ts");
const { waveRpc, WAVE_ERROR_CODES } = await load("shared", "wave-rpc.ts");
const { parseFrontmatter } = await load("server", "frontmatter.ts");

const norm = (text) => text.replace(/\r\n/g, "\n");

// PLAN files are CRLF, a SUMMARY is a status word or raw frontmatter, args.json starts with a byte-order mark.
function waveProject(plans, args = { phaseDir: ".planning/phases/02-api", wave: 1 }) {
  const root = makeTempDir("ui office wave ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  for (const [id, wave, summary] of plans) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\r\nphase: 02\r\nplan: ${id}\r\nwave: ${wave}\r\n---\r\n# plan\r\n`, "utf8");
    if (summary !== undefined && summary !== false) fs.writeFileSync(path.join(dir, `02-${id}-SUMMARY.md`), summary.startsWith("---") ? summary : `---\nstatus: ${summary}\n---\n`, "utf8");
  }
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x", status: "running" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), "﻿" + JSON.stringify(args), "utf8");
  return root;
}

const MIGRATED = [["01", 1, "complete"], ["02", 1, "complete"], ["03", 1, false], ["04", 1, "halted"], ["05", 2, "complete"], ["06", 1, "---\nphase: 02\n---\n"]];

test("OFFC-18 wave link: the migrated fixture gives the same counts and a 2 of 4 fixture gives 2 of 4", async () => {
  const w = new WaveLinker();
  assert.deepEqual(await w.link(waveProject(MIGRATED), "wf_x"), { phase: "02", wave: 1, plansDone: 3, plansTotal: 5, scope: "complete" });
  const two = waveProject([["01", 1, "complete"], ["02", 1, "complete"], ["03", 1, false], ["04", 1, "halted"]]);
  assert.deepEqual(await w.link(two, "wf_x"), { phase: "02", wave: 1, plansDone: 2, plansTotal: 4, scope: "complete" });
  const noWave = waveProject(MIGRATED, { phaseDir: ".planning/phases/02-api" });
  assert.deepEqual(await w.link(noWave, "wf_x"), { phase: "02", wave: null, plansDone: 4, plansTotal: 6, scope: "complete" });
});

test("OFFC-18 wave link: a run id with a separator or dot segment, a missing run and a null project give no link", async () => {
  const root = waveProject(MIGRATED);
  const w = new WaveLinker();
  for (const id of ["..", ".", "a/b", "a\\b", "../wf_x", "", null, "wf_missing"]) assert.equal(await w.link(root, id), null, String(id));
  assert.equal(await w.link(null, "wf_x"), null);
  fs.writeFileSync(path.join(root, "_workspace", "_runs", "wf_x", "args.json"), JSON.stringify({ phaseDir: "../outside" }), "utf8");
  assert.equal(await w.link(root, "wf_x"), null, "phaseDir outside .planning/phases is no link");
});

test("OFFC-18 wave link: an unfinished, malformed or unreadable SUMMARY withholds the counts", async () => {
  const unreadable = { phase: "02", wave: 1, plansDone: null, plansTotal: null, scope: "unreadable" };
  for (const bad of ["---\nstatus: complete\n", "---\nstatus: [halted\n---\n"]) {
    const root = waveProject([["01", 1, "complete"], ["02", 1, bad]]);
    assert.deepEqual(await new WaveLinker().link(root, "wf_x"), unreadable, JSON.stringify(bad));
  }
  const root = waveProject([["01", 1, "complete"], ["02", 1, false]]);
  fs.mkdirSync(path.join(root, ".planning", "phases", "02-api", "02-02-SUMMARY.md"));
  assert.deepEqual(await new WaveLinker().link(root, "wf_x"), unreadable, "a SUMMARY that cannot be read is not absent");
});

test("OFFC-18 wave link: junctions and symlinks out of the project are never followed", async () => {
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

test("OFFC-18 wave link: a changed SUMMARY is reparsed and the cache is bounded", async () => {
  const root = waveProject([["01", 1, "complete"], ["02", 1, "complete"]]);
  const w = new WaveLinker();
  assert.equal((await w.link(root, "wf_x")).plansDone, 2);
  const summary = path.join(root, ".planning", "phases", "02-api", "02-02-SUMMARY.md");
  fs.writeFileSync(summary, "---\nstatus: halted\n---\n", "utf8");
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(summary, later, later);
  assert.equal((await w.link(root, "wf_x")).plansDone, 1, "a new mtime is reparsed");

  const small = new WaveLinker({ cacheMaxEntries: 8 });
  const many = waveProject(Array.from({ length: 12 }, (_, i) => [String(i + 1).padStart(2, "0"), 1, i % 3 === 0 ? "halted" : "complete"]));
  const expected = await new WaveLinker().link(many, "wf_x");
  assert.deepEqual(await small.link(many, "wf_x"), expected);
  assert.ok(small.size > 0 && small.size <= 8, `cache holds ${small.size}`);
  small.clear();
  assert.equal(small.size, 0);
  for (const bad of [0, 1.5, -1, Number.NaN]) assert.throws(() => new WaveLinker({ cacheMaxEntries: bad }), RangeError, String(bad));
});

test("OFFC-18 wave link: more PLAN files than WAVE_PLANS_MAX withholds the counts", async () => {
  const plans = (n) => Array.from({ length: n }, (_, i) => [String(i + 1).padStart(2, "0"), 1, "complete"]);
  const at = await new WaveLinker().link(waveProject(plans(WAVE_PLANS_MAX)), "wf_x");
  assert.equal(at.scope, "complete");
  assert.equal(at.plansTotal, WAVE_PLANS_MAX);
  const over = await new WaveLinker().link(waveProject(plans(WAVE_PLANS_MAX + 1)), "wf_x");
  assert.deepEqual(over, { phase: "02", wave: 1, plansDone: null, plansTotal: null, scope: "unreadable" });
});

test("OFFC-18 frontmatter: the office parser is the planning panel's byte for byte", () => {
  const office = fs.readFileSync(path.join(OFFICE, "server", "frontmatter.ts"), "utf8");
  const panel = fs.readFileSync(path.join(KIT_DIR, "plugins", "planning-panel", "server", "frontmatter.ts"), "utf8");
  assert.equal(norm(office), norm(panel));
  const bom = parseFrontmatter("﻿---\r\nplan: 01\r\nstatus: complete\r\n---\r\nbody\r\n");
  assert.equal(bom.error, undefined);
  assert.equal(bom.data.plan, 1);
  const open = parseFrontmatter("---\nstatus: complete\n");
  assert.equal(typeof open.error, "string");
  assert.equal(typeof open.line, "number");
});

test("OFFC-03 wave contract: name, input shape and output schema", () => {
  assert.equal(waveRpc.name, "office.wave");
  assert.deepEqual(Object.keys(waveRpc.input.shape).sort(), ["runId", "workspaceId"]);
  const out = waveRpc.output;
  assert.ok(out.safeParse({ ok: true, link: null }).success);
  assert.ok(out.safeParse({ ok: true, link: { phase: "02", wave: null, plansDone: null, plansTotal: null, scope: "unreadable" } }).success);
  assert.ok(out.safeParse({ ok: false, code: "bad_input", message: "m" }).success);
  assert.ok(!out.safeParse({ ok: false, code: "nope", message: "m" }).success);
  assert.ok(!out.safeParse({ ok: true, link: { phase: "02", wave: 1, plansDone: 1, plansTotal: 1, scope: "truncated" } }).success);
  assert.deepEqual([...WAVE_ERROR_CODES], ["bad_input", "not_found", "failed"]);
});

// Lines that import fs or call a file-reading function, after comment lines and CRLF are removed.
const READERS = /from\s+["'](?:node:)?fs(?:\/promises)?["']|require\(\s*["'](?:node:)?fs|\b(?:readFile|readdir|readlink|realpath|opendir|createReadStream)(?:Sync)?\s*\(/;
function readsFiles(text) {
  return READERS.test(norm(text).replace(/^\s*\/\/.*$/gm, ""));
}

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test("OFFC-18 only reader: no module outside server/wave-link.ts reads a file", () => {
  for (const sample of ['import fs from "node:fs";', 'import { promises } from "fs";', "const t = await readFile(p);", "x.readdirSync(d)", "realpath(p)", "createReadStream(p)"]) {
    assert.ok(readsFiles(sample), sample);
  }
  assert.ok(!readsFiles("// import fs from 'node:fs';\nconst a = 1;"));
  assert.ok(!readsFiles("export const a = 1;"));
  const files = [...["client", "server", "shared"].flatMap((d) => sourceFiles(path.join(OFFICE, d))), path.join(OFFICE, "index.client.tsx"), path.join(OFFICE, "index.server.ts")];
  const readers = files.filter((f) => readsFiles(fs.readFileSync(f, "utf8"))).map((f) => path.relative(OFFICE, f).split(path.sep).join("/"));
  assert.deepEqual(readers, ["server/wave-link.ts"]);
});
