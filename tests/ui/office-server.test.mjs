// OFFC-03 / OFFC-05: the office plugin server registers exactly two read-only handlers, each answers every outcome as a typed envelope.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakePaseo, fakeServer } from "./fake-paseo.mjs";

const OFFICE = path.join(KIT_DIR, "plugins", "office");
const load = (...parts) => import(pathToFileURL(path.join(OFFICE, ...parts)).href);
const { default: contribute } = await load("index.server.ts");
const { createWaveHandler, WaveLinker } = await load("server", "wave-link.ts");
const { createSpritesHandler } = await load("server", "sprites.ts");
const { waveRpc, WAVE_ERROR_CODES, WAVE_WORKSPACE_ID_MAX_CHARS, WAVE_RUN_ID_MAX_CHARS } = await load("shared", "wave-rpc.ts");
const { spritesRpc, CALL_ERROR_CODES, SPRITE_KEYS_PER_CALL_MAX } = await load("shared", "sprites-rpc.ts");

const norm = (text) => text.replace(/\r\n/g, "\n");

function waveProject() {
  const root = makeTempDir("ui office server ");
  const dir = path.join(root, ".planning", "phases", "02-api");
  fs.mkdirSync(dir, { recursive: true });
  const plans = [["01", 1, "complete"], ["02", 1, "complete"], ["03", 1, false], ["04", 1, "halted"], ["05", 2, "complete"], ["06", 1, "---\nphase: 02\n---\n"]];
  for (const [id, wave, summary] of plans) {
    fs.writeFileSync(path.join(dir, `02-${id}-PLAN.md`), `---\r\nphase: 02\r\nplan: ${id}\r\nwave: ${wave}\r\n---\r\n# plan\r\n`, "utf8");
    if (summary) fs.writeFileSync(path.join(dir, `02-${id}-SUMMARY.md`), summary.startsWith("---") ? summary : `---\nstatus: ${summary}\n---\n`, "utf8");
  }
  const run = path.join(root, "_workspace", "_runs", "wf_x");
  fs.mkdirSync(run, { recursive: true });
  fs.writeFileSync(path.join(run, "run.json"), JSON.stringify({ runId: "wf_x" }), "utf8");
  fs.writeFileSync(path.join(run, "args.json"), JSON.stringify({ phaseDir: ".planning/phases/02-api", wave: 1 }), "utf8");
  return root;
}

// A paseo whose workspaces.ref is a spy; `shape` builds the handle for a workspace id.
function spyPaseo(shape) {
  const calls = [];
  return { calls, workspaces: { ref: (id) => (calls.push(id), shape(id)) } };
}

const recordHandle = (directory) => ({ directory, current: () => ({ workspaceDirectory: directory }), refresh: async () => null });

function spyLinker(result = null) {
  const calls = [];
  return { calls, link: async (project, runId) => (calls.push([project, runId]), result) };
}

test("OFFC-03 server: contribute registers office.sprites and office.wave and the disposer clears the wave cache", async () => {
  const server = fakeServer();
  const dispose = contribute(server);
  assert.deepEqual([...server.handlers.keys()].sort(), ["office.sprites", "office.wave"]);
  assert.equal(server.subscriptions(), 0);
  const root = waveProject();
  const out = await server.handlers.get("office.wave")({ workspaceId: "ws1", runId: "wf_x" }, { paseo: fakePaseo({ workspaces: { ws1: root } }) });
  assert.equal(out.ok, true);
  assert.equal(typeof dispose, "function");
  dispose();
  dispose();
  const linker = new WaveLinker();
  await linker.link(root, "wf_x");
  assert.ok(linker.size > 0);
  linker.clear();
  assert.equal(linker.size, 0);
});

test("OFFC-18 office.wave: the directory comes from the workspace id only and the counts are the migrated ones", async () => {
  const root = waveProject();
  const server = fakeServer();
  contribute(server);
  const handler = server.handlers.get("office.wave");
  const out = await handler({ workspaceId: "ws1", runId: "wf_x" }, { paseo: fakePaseo({ workspaces: { ws1: root } }) });
  assert.deepEqual(out, { ok: true, link: { phase: "02", wave: 1, plansDone: 3, plansTotal: 5, scope: "complete" } });

  const linker = spyLinker();
  const handle = createWaveHandler({ linker });
  const hostile = { workspaceId: "ws1", runId: "wf_x", path: "/etc", directory: "/tmp/other", cwd: "/tmp/cwd" };
  const res = await handle(hostile, { paseo: fakePaseo({ workspaces: { ws1: root } }) });
  assert.equal(res.ok, true);
  assert.deepEqual(linker.calls, [[root, "wf_x"]]);
});

test("OFFC-18 office.wave: an unknown workspace is not_found; no directory or no run is ok with no link", async () => {
  const handle = createWaveHandler();
  const unknown = await handle({ workspaceId: "nope", runId: "wf_x" }, { paseo: fakePaseo() });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "not_found");

  const noDir = spyPaseo(() => ({ directory: null, current: () => ({ workspaceDirectory: null }), refresh: async () => null }));
  assert.deepEqual(await handle({ workspaceId: "ws1", runId: "wf_x" }, { paseo: noDir }), { ok: true, link: null });

  const root = waveProject();
  assert.deepEqual(await handle({ workspaceId: "ws1", runId: "wf_missing" }, { paseo: fakePaseo({ workspaces: { ws1: root } }) }), { ok: true, link: null });
  const other = waveProject();
  assert.deepEqual(await handle({ workspaceId: "ws2", runId: "wf_other" }, { paseo: fakePaseo({ workspaces: { ws2: other } }) }), { ok: true, link: null });
});

test("OFFC-03 office.wave: malformed ids are bad_input and never reach paseo or the linker", async () => {
  const linker = spyLinker();
  const paseo = spyPaseo(() => recordHandle("/tmp/x"));
  const handle = createWaveHandler({ linker });
  const inputs = [
    null, undefined, 5, "x", [], {},
    { workspaceId: "ws1" }, { runId: "wf_x" },
    { workspaceId: 1, runId: "wf_x" }, { workspaceId: "ws1", runId: 2 },
    { workspaceId: "", runId: "wf_x" },
    { workspaceId: "ws\u0000", runId: "wf_x" }, { workspaceId: "ws\n1", runId: "wf_x" },
    { workspaceId: "w".repeat(WAVE_WORKSPACE_ID_MAX_CHARS + 1), runId: "wf_x" },
    ...["..", ".", ".x", "a/b", "a\\b", "a b", "", "r".repeat(WAVE_RUN_ID_MAX_CHARS + 1)].map((runId) => ({ workspaceId: "ws1", runId })),
  ];
  for (const input of inputs) {
    const out = await handle(input, { paseo });
    assert.equal(out.ok, false, JSON.stringify(input));
    assert.equal(out.code, "bad_input", JSON.stringify(input));
    assert.ok(!out.message.includes("w".repeat(20)) && !out.message.includes("a/b") && !out.message.includes("ws\u0000"), "the message never echoes the input");
  }
  assert.deepEqual(paseo.calls, []);
  assert.deepEqual(linker.calls, []);
});

test("OFFC-03 office.wave: a throwing lookup, refresh or linker gives failed without raw exception text", async () => {
  const secret = "SECRET C:\\private\\path at stack";
  const input = { workspaceId: "ws1", runId: "wf_x" };
  const cases = [
    [spyPaseo(() => { throw new Error(secret); }), spyLinker()],
    [spyPaseo(() => ({ directory: null, current: () => null, refresh: async () => { throw new Error(secret); } })), spyLinker()],
    [spyPaseo(() => recordHandle("/tmp/x")), { link: async () => { throw new Error(secret); } }],
  ];
  for (const [paseo, linker] of cases) {
    const out = await createWaveHandler({ linker })(input, { paseo });
    assert.equal(out.ok, false);
    assert.equal(out.code, "failed");
    assert.ok(!out.message.includes("SECRET") && !out.message.includes("private") && !out.message.includes("stack"));
  }
});

// ---------------------------------------------------------------- OFFC-03 contract suite over both handlers

const SPRITE_FIXTURES = [
  { keys: [] },
  { keys: ["ruler:a:-:2:0"] },
  { keys: ["not a key", "x".repeat(500)] },
  { keys: ["../../etc/passwd", "ruler:a:-:999:9"] },
];
const WAVE_FIXTURES = [
  { workspaceId: "ws1", runId: "wf_x" },
  { workspaceId: "ws1", runId: "wf_missing" },
  { workspaceId: "ws1" },
  { workspaceId: "ws1", runId: "../x", path: "/etc/passwd" },
];

test("OFFC-03 contracts: every handler output parses with its own schema", async () => {
  const root = waveProject();
  const server = fakeServer();
  contribute(server);
  const sprites = server.handlers.get(spritesRpc.name);
  const waves = server.handlers.get(waveRpc.name);
  for (const input of SPRITE_FIXTURES) {
    const out = await sprites(input);
    assert.ok(spritesRpc.output.safeParse(out).success, JSON.stringify(input));
  }
  for (const input of WAVE_FIXTURES) {
    const out = await waves(input, { paseo: fakePaseo({ workspaces: { ws1: root } }) });
    assert.ok(waveRpc.output.safeParse(out).success, JSON.stringify(input));
  }
});

test("OFFC-03 contracts: malformed input, an oversized key list and a throwing dependency give ok false with a code for each handler", async () => {
  const thrown = "BOOM-thrown-text";
  const boom = () => { throw new Error(thrown); };
  const sprites = createSpritesHandler({ cache: { get: boom, set: boom } });
  const keys = (n) => Array.from({ length: n }, (_, i) => `ruler:s${i}:-:2:0`);
  const spriteInputs = [null, undefined, 5, {}, { keys: "x" }, { keys: [1] }, { keys: keys(SPRITE_KEYS_PER_CALL_MAX + 1) }, { keys: ["ruler:a:-:2:0"] }];
  for (const input of spriteInputs) {
    let out;
    assert.doesNotThrow(() => { out = sprites(input); }, JSON.stringify(input));
    assert.equal(out.ok, false, JSON.stringify(input));
    assert.ok(CALL_ERROR_CODES.includes(out.code), out.code);
    assert.ok(!out.message.includes(thrown));
  }

  const okPaseo = spyPaseo(() => recordHandle("/tmp/x"));
  const waveCases = [
    [null, okPaseo, spyLinker()],
    [{}, okPaseo, spyLinker()],
    [{ workspaceId: "ws1" }, okPaseo, spyLinker()],
    [{ workspaceId: "ws1", runId: "../x" }, okPaseo, spyLinker()],
    [{ workspaceId: "ws1", runId: "wf_x" }, spyPaseo(boom), spyLinker()],
    [{ workspaceId: "ws1", runId: "wf_x" }, okPaseo, { link: async () => boom() }],
  ];
  for (const [input, paseo, linker] of waveCases) {
    const out = await createWaveHandler({ linker })(input, { paseo });
    assert.equal(out.ok, false, JSON.stringify(input));
    assert.ok(WAVE_ERROR_CODES.includes(out.code), out.code);
    assert.ok(!out.message.includes(thrown));
  }
});

test("OFFC-03 contracts: RPC names match the pattern, are unique and no input shape has a path-like field", () => {
  const contracts = [spritesRpc, waveRpc];
  const names = contracts.map((c) => c.name);
  for (const name of names) {
    assert.match(name, /^[a-z][a-z0-9._-]*$/);
    assert.ok(name.startsWith("office."), name);
  }
  assert.equal(new Set(names).size, names.length);
  for (const c of contracts) {
    for (const key of Object.keys(c.input.shape)) assert.doesNotMatch(key, /path|dir|directory|cwd|file|uri|url/i, `${c.name}.${key}`);
  }
  const server = fakeServer();
  contribute(server);
  assert.deepEqual([...server.handlers.keys()].sort(), [...names].sort());
});

function sourceFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

const BUILTINS = /^(?:node:.*|fs|path|os|zlib|crypto|buffer|stream)$/;
const UI = /^(?:react|react-native)$/;
function badImports(text) {
  const bad = [];
  for (const m of norm(text).replace(/^\s*\/\/.*$/gm, "").matchAll(/\bfrom\s+["']([^"']+)["']|\bimport\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)/g)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (BUILTINS.test(spec)) bad.push(`builtin ${spec}`);
    if (UI.test(spec)) bad.push(`ui ${spec}`);
    if (spec.includes("/server/")) bad.push(`server ${spec}`);
  }
  return bad;
}

test("OFFC-03 shared: no Node builtin, no React and no server import in plugins/office/shared", () => {
  assert.deepEqual(badImports('import fs from "node:fs";'), ["builtin node:fs"]);
  assert.deepEqual(badImports('import { join } from "path";'), ["builtin path"]);
  assert.deepEqual(badImports('import React from "react";'), ["ui react"]);
  assert.deepEqual(badImports('import { x } from "../server/wave-link.ts";'), ["server ../server/wave-link.ts"]);
  assert.deepEqual(badImports('import { z } from "zod";\nimport { a } from "./art-types.ts";'), []);
  const dir = path.join(OFFICE, "shared");
  const files = sourceFiles(dir);
  assert.ok(files.length >= 2);
  for (const file of files) assert.deepEqual(badImports(fs.readFileSync(file, "utf8")), [], path.relative(OFFICE, file));
});

const POLLING = /\b(?:setInterval|setTimeout)\b/;
const SUBSCRIPTION = /\bserver\.on\(/;
function polls(text) {
  const code = norm(text).replace(/^\s*\/\/.*$/gm, "");
  return POLLING.test(code) || SUBSCRIPTION.test(code);
}

test("OFFC-05 server: the plugin server polls nothing", () => {
  assert.ok(polls("setInterval(() => {}, 5)"));
  assert.ok(polls("const t = setTimeout(f, 1);"));
  assert.ok(polls("server.on('agent', f);"));
  assert.ok(!polls("// setInterval would poll\nconst a = 1;"));
  const files = [...sourceFiles(path.join(OFFICE, "server")), path.join(OFFICE, "index.server.ts")];
  for (const file of files) assert.ok(!polls(fs.readFileSync(file, "utf8")), path.relative(OFFICE, file));
});
