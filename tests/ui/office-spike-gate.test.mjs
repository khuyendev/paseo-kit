// Spike gate (07-03, D-12, OFFC-10): fails until 07-SPIKE.md holds the owner's recorded measurement with a pass verdict.
// checkRecord reads nothing but the two documents it is given; the spike tests import the spike modules only when they exist,
// so retiring the spike code in 07-11 cannot break this file.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import zlib from "node:zlib";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const OFFICE = path.join(ROOT, "plugins", "office");
const PHASE_DIR = path.join(ROOT, ".planning", "phases", "07-office");
const SPIKE_MD = path.join(PHASE_DIR, "07-SPIKE.md");
const THRESHOLDS_JSON = path.join(PHASE_DIR, "07-SPIKE-THRESHOLDS.json");
const DESKTOP_ONLY = "Desktop only; mobile not tested; one host.";
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const norm = (text) => text.replace(/\r\n/g, "\n");
const read = (file) => norm(fs.readFileSync(file, "utf8"));
const load = (...parts) => import(pathToFileURL(path.join(OFFICE, ...parts)).href);
const spikeExists = (...parts) => fs.existsSync(path.join(OFFICE, ...parts));

// ---------------------------------------------------------------- record checker

const APPENDED = /^## (SPIKE_SMOOTHNESS_RULE|SPIKE_WAIVER|SPIKE_MEASUREMENTS|Selected levels|SPIKE_VERDICT|SPIKE_UPDATE_LOG|Observations)$/m;

function section(md, heading) {
  const start = new RegExp(`^## ${heading}$`, "m").exec(md);
  if (!start) return null;
  const rest = md.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

const jsonBlocks = (text) => [...text.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => m[1]);

// Independent recomputation of levels and verdict from the dated thresholds and the recorded numbers.
function recompute(t, block) {
  const problems = [];
  const incomplete = [];
  const num = (v) => typeof v === "number" && Number.isFinite(v);
  const c = block.cadence ?? {};
  if (!num(c.medianMs) || c.medianMs > t.cadence.medianMsMax) problems.push(`cadence median ${c.medianMs} above ${t.cadence.medianMsMax}`);
  if (!num(c.p95Ms) || c.p95Ms > t.cadence.p95MsMax) problems.push(`cadence p95 ${c.p95Ms} above ${t.cadence.p95MsMax}`);
  if (c.windowSeconds !== t.cadence.windowSeconds) problems.push("cadence window differs from the thresholds");
  const scene = block.scene ?? {};
  if (!(scene.animatedCharacters >= t.maxDrawnCharacters)) problems.push(`animated ${scene.animatedCharacters} below ${t.maxDrawnCharacters}`);
  if (!(scene.walkingCharacters >= t.walkingCharacters)) problems.push(`walking ${scene.walkingCharacters} below ${t.walkingCharacters}`);
  const zoomLevels = t.zoomCandidates.filter((z) => block.crispness?.[String(z)] === true);
  if (t.zoomCandidates.some((z) => block.crispness?.[String(z)] === null || block.crispness?.[String(z)] === undefined)) incomplete.push("incomplete: a crispness answer is missing");
  if (zoomLevels.length === 0) problems.push("zoom levels empty");
  const bytesZoom = zoomLevels.length > 0 ? Math.max(...zoomLevels) : null;
  const firstLoad = bytesZoom === null ? undefined : block.firstLoadBytes?.[String(bytesZoom)];
  if (bytesZoom !== null && (!num(firstLoad) || firstLoad > t.firstLoadBytesMax)) problems.push(`first load ${firstLoad} above ${t.firstLoadBytesMax}`);
  const steady = block.steadyState ?? {};
  if (!num(steady.bytes) || steady.bytes > t.steadyState.bytesMax) problems.push(`steady state ${steady.bytes} above ${t.steadyState.bytesMax}`);
  if (steady.windowSeconds !== t.steadyState.windowSeconds) problems.push("steady window differs from the thresholds");
  let tintLevels = null;
  const variants = bytesZoom === null ? undefined : block.tintBytes?.[String(bytesZoom)];
  if (num(firstLoad) && Array.isArray(variants)) {
    for (let n = 2; n <= 5; n++) {
      const total = firstLoad + variants.slice(0, n - 1).reduce((a, b) => a + b, 0);
      if (variants.length >= n - 1 && total <= t.firstLoadBytesMax) tintLevels = n;
    }
  }
  if (tintLevels === null) problems.push("tint levels below 2");
  const surfaces = block.surfaces ?? {};
  for (const name of ["agents", "workspaces", "projects", "events", "timeline"]) {
    const outcome = surfaces[name]?.outcome ?? "not_run";
    if (outcome === "not_run" || outcome === "pending") incomplete.push(`incomplete: surface ${name} is ${outcome}`);
  }
  for (const name of ["agents", "workspaces", "projects"]) {
    const s = surfaces[name];
    if (s && (s.outcome === "error" || (s.outcome === "ok" && !num(s.seed)))) problems.push(`surface ${name} seed failed`);
  }
  if (block.smoothness === null || block.smoothness === undefined) incomplete.push("incomplete: the smoothness answer is missing");
  else if (block.smoothness.answer !== "yes") problems.push("smoothness answer is no");
  else if (block.smoothness.zoom !== scene.zoomMeasured) problems.push("smoothness zoom differs from the cadence zoom");
  const verdict = incomplete.length > 0 ? "incomplete" : problems.length === 0 ? "pass" : "fail";
  return { zoomLevels, tintLevels, verdict, problems: [...problems, ...incomplete] };
}

// The owner may waive the spike gate (D-12) instead of measuring: a dated, reasoned SPIKE_WAIVER section with provisional
// levels that the code constants must equal. It is not a pass: the measurement stays owed, the waiver ends the moment a
// SPIKE_MEASUREMENTS block is recorded (both present is a problem) and every run of this file prints the warning.
const WAIVER_NOT_MEASURED = "No measurement recorded (the owner gave no report): crispness, payload, cadence, steady state, update log.";
function waiverProblems(waiver, dated) {
  const problems = [];
  if (!/^Waived by: owner$/m.test(waiver)) problems.push("the waiver is not by the owner");
  const at = /^Dated: (\S+)$/m.exec(waiver)?.[1];
  if (!at || !ISO.test(at)) problems.push("the waiver has no ISO Dated line");
  else if (dated && at <= dated) problems.push("the waiver is older than the thresholds");
  if (!/^Reason: \S/m.test(waiver)) problems.push("the waiver has no reason");
  if (!waiver.includes(WAIVER_NOT_MEASURED)) problems.push("the waiver does not state what was not measured");
  if (!/^Measurement owed: yes$/m.test(waiver)) problems.push("the waiver does not say the measurement is owed");
  const zoom = /^Provisional ZOOM_LEVELS: (\[[0-9, ]*\])$/m.exec(waiver)?.[1];
  const tint = /^Provisional TINT_LEVELS: (\d+)$/m.exec(waiver)?.[1];
  let zooms = null;
  try {
    zooms = zoom ? JSON.parse(zoom) : null;
  } catch {
    zooms = null;
  }
  if (!Array.isArray(zooms) || zooms.length === 0) problems.push("the waiver has no provisional ZOOM_LEVELS");
  if (!tint || Number(tint) < 2 || Number(tint) > 5) problems.push("the waiver has no provisional TINT_LEVELS between 2 and 5");
  return problems;
}
const parseWaiver = (waiver) => ({
  zoomLevels: JSON.parse(/^Provisional ZOOM_LEVELS: (\[[0-9, ]*\])$/m.exec(waiver)[1]),
  tintLevels: Number(/^Provisional TINT_LEVELS: (\d+)$/m.exec(waiver)[1]),
});

// Returns the list of problems of a record; an empty list is a consistent recorded pass.
function checkRecord(markdownText, thresholds, firstCommitText) {
  const md = norm(markdownText);
  const problems = [];
  const cut = APPENDED.exec(md);
  const base = cut ? md.slice(0, cut.index) : md;
  const dated = /^Dated: (\S+)$/m.exec(base)?.[1];
  if (!dated || !ISO.test(dated)) problems.push("the thresholds have no ISO Dated line");
  if (typeof firstCommitText === "string" && norm(firstCommitText).trimEnd() !== base.trimEnd()) problems.push("the threshold section differs from its first committed version");
  const blocks = jsonBlocks(base);
  if (blocks.length !== 1) problems.push("the threshold section has no single machine copy");
  else {
    try {
      assert.deepEqual(JSON.parse(blocks[0]), thresholds);
    } catch {
      problems.push("the machine copy differs from the thresholds JSON");
    }
  }
  const rule = section(md, "SPIKE_SMOOTHNESS_RULE");
  const ruleDated = rule ? /^Dated: (\S+)$/m.exec(rule)?.[1] : undefined;
  if (rule === null) problems.push("missing SPIKE_SMOOTHNESS_RULE section");
  else if (!ruleDated || !ISO.test(ruleDated)) problems.push("the SPIKE_SMOOTHNESS_RULE section has no ISO Dated line");
  else if (dated && ruleDated < dated) problems.push("the SPIKE_SMOOTHNESS_RULE section is dated before the thresholds");
  const measurements = section(md, "SPIKE_MEASUREMENTS");
  const waiver = section(md, "SPIKE_WAIVER");
  if (waiver !== null) {
    if (measurements !== null) problems.push("SPIKE_WAIVER and SPIKE_MEASUREMENTS are both present: the waiver ends when the measurement is recorded, remove it");
    else problems.push(...waiverProblems(waiver, dated));
    return problems;
  }
  if (measurements === null) {
    problems.push("no SPIKE_MEASUREMENTS block");
    return problems;
  }
  const measured = /^Measured: (\S+)$/m.exec(measurements)?.[1];
  if (!measured || !ISO.test(measured)) problems.push("the measurement has no ISO Measured line");
  else {
    if (dated && measured <= dated) problems.push("the measurement is older than the thresholds");
    if (ruleDated && ruleDated > measured) problems.push("the SPIKE_SMOOTHNESS_RULE section is dated after the measurement");
  }
  if (!measurements.includes(DESKTOP_ONLY)) problems.push("the Desktop-only sentence is missing");
  const found = jsonBlocks(measurements);
  let block = null;
  try {
    block = found.length === 1 ? JSON.parse(found[0]) : null;
  } catch {
    block = null;
  }
  if (!block || block.id !== "SPIKE_MEASUREMENTS") {
    problems.push("the measurement has no SPIKE_MEASUREMENTS json block");
    return problems;
  }
  if (typeof block.host !== "string" || block.host.trim() === "") problems.push("host is empty");
  if (typeof block.displayScale !== "string" || block.displayScale.trim() === "") problems.push("displayScale is empty");
  const again = recompute(thresholds, block);
  problems.push(...again.problems);
  if (JSON.stringify(block.zoomLevels) !== JSON.stringify(again.zoomLevels)) problems.push("recorded zoomLevels differ from the recomputed levels");
  if (block.tintLevels !== again.tintLevels) problems.push("recorded tintLevels differ from the recomputed levels");
  if (block.verdict !== again.verdict) problems.push(`recorded verdict ${block.verdict} differs from the recomputed verdict ${again.verdict}`);
  const verdictSection = section(md, "SPIKE_VERDICT");
  const first = verdictSection?.split("\n").find((l) => l.trim() !== "");
  if (!first || !/^Verdict: (pass|fail)$/.test(first)) problems.push("SPIKE_VERDICT has no first Verdict line");
  else if (first !== `Verdict: ${again.verdict}`) problems.push("the SPIKE_VERDICT line differs from the recomputed verdict");
  if (first === "Verdict: fail" || block.verdict === "fail") problems.push("the recorded verdict is fail");
  return problems;
}

// ---------------------------------------------------------------- helpers

function gitOut(args) {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

function firstCommitOf(file) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const hashes = gitOut(["log", "--format=%H", "--follow", "--", rel])?.split("\n").filter(Boolean);
  if (!hashes || hashes.length === 0) return null;
  return gitOut(["show", `${hashes.at(-1)}:${rel}`]);
}

const thresholds = () => JSON.parse(fs.readFileSync(THRESHOLDS_JSON, "utf8"));

function pngSize(uri) {
  const bytes = Buffer.from(uri.slice("data:image/png;base64,".length), "base64");
  return { w: bytes.readUInt32BE(16), h: bytes.readUInt32BE(20) };
}

function decodeUri(uri) {
  const png = Buffer.from(uri.slice("data:image/png;base64,".length), "base64");
  let pos = 8;
  let w = 0;
  let h = 0;
  const idat = [];
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    if (type === "IHDR") {
      w = png.readUInt32BE(pos + 8);
      h = png.readUInt32BE(pos + 12);
    }
    if (type === "IDAT") idat.push(png.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  return { w, h, rgba };
}

// ---------------------------------------------------------------- sheet layout, zoom and tint rules

test("OFFC-09 sheet layout: sheetSize and sheetCell are one row per pose and direction, one column per frame", async () => {
  const { DIRS, POSE_FRAMES, POSE_NAMES, canonicalPoses, sheetCell, sheetSize } = await load("shared", "art-types.ts");
  assert.deepEqual(sheetSize(["walk", "stand"]), { cols: 4, rows: 8 });
  assert.deepEqual(sheetSize(["stand"]), { cols: 2, rows: 4 });
  assert.deepEqual(canonicalPoses(["walk", "stand", "walk"]), ["stand", "walk"]);
  assert.throws(() => canonicalPoses([]), RangeError);
  assert.throws(() => canonicalPoses(["fly"]), RangeError);
  assert.deepEqual(sheetCell(["walk", "stand"], "stand", "down", 1), { col: 1, row: 0 });
  assert.deepEqual(sheetCell(["walk", "stand"], "walk", "right", 3), { col: 3, row: 7 });
  assert.throws(() => sheetCell(["stand"], "walk", "down", 0), RangeError);
  assert.throws(() => sheetCell(["stand"], "stand", "diagonal", 0), RangeError);
  for (const frame of [0.5, -1, POSE_FRAMES.stand]) assert.throws(() => sheetCell(["stand"], "stand", "down", frame), RangeError);
  const poses = ["stand", "walk", "type", "sit"];
  const { cols, rows } = sheetSize(poses);
  const seen = new Set();
  for (const pose of canonicalPoses(poses)) {
    for (const dir of DIRS) {
      for (let frame = 0; frame < POSE_FRAMES[pose]; frame++) {
        const cell = sheetCell(poses, pose, dir, frame);
        assert.ok(cell.col < cols && cell.row < rows);
        seen.add(`${cell.col},${cell.row}`);
      }
    }
  }
  assert.equal(seen.size, [...canonicalPoses(poses)].reduce((n, p) => n + POSE_FRAMES[p] * DIRS.length, 0));
  assert.deepEqual(DIRS, ["down", "up", "left", "right"]);
  assert.ok(POSE_NAMES.length > 0);
});

test("OFFC-09 zoom rule: the zoom levels are the candidates that passed crispness", async () => {
  const { ZOOM_CANDIDATES, selectZoomLevels } = await load("shared", "art-types.ts");
  assert.deepEqual(selectZoomLevels({ 2: true, 3: true, 4: false }), [2, 3]);
  assert.deepEqual(selectZoomLevels({ 2: false, 3: false, 4: false }), []);
  assert.deepEqual(selectZoomLevels({ 4: true }), [4]);
  assert.deepEqual(selectZoomLevels({ 4: true, 2: true, 7: true }), [2, 4]);
  for (const z of selectZoomLevels({ 2: true, 3: true, 4: true })) assert.ok(ZOOM_CANDIDATES.includes(z));
});

test("OFFC-17 tint rule: the largest variant count whose first load fits", async () => {
  const { SPRITE_TINT_INDEX_MAX } = await load("shared", "sprites-rpc.ts");
  const { TINT_MAX_LEVELS, TINT_MIN_LEVELS, firstLoadBytesWithTint, selectTintLevels } = await load("shared", "tint.ts");
  assert.equal(firstLoadBytesWithTint(1000, [100, 200, 300, 400], 1), 1000);
  assert.equal(firstLoadBytesWithTint(1000, [100, 200, 300, 400], 3), 1300);
  assert.equal(firstLoadBytesWithTint(1000, [100, 200, 300, 400], 5), 2000);
  for (const levels of [0, 6, 2.5]) assert.throws(() => firstLoadBytesWithTint(1000, [100, 200, 300, 400], levels), RangeError);
  assert.equal(selectTintLevels(1000, [100, 200, 300, 400], 1300), 3);
  assert.equal(selectTintLevels(1000, [100, 200, 300, 400], 1050), null);
  assert.equal(selectTintLevels(1000, [100, 200, 300, 400], 5000), 5);
  assert.equal(TINT_MAX_LEVELS - 1, SPRITE_TINT_INDEX_MAX);
  assert.equal(TINT_MIN_LEVELS, 2);
});

test("OFFC-10 limits: MAX_DRAWN_CHARACTERS equals the dated threshold", async () => {
  const { MAX_DRAWN_CHARACTERS } = await load("client", "limits.ts");
  assert.equal(MAX_DRAWN_CHARACTERS, thresholds().maxDrawnCharacters);
});

// ---------------------------------------------------------------- record checker fixtures

const originalSpike = () => {
  const md = read(SPIKE_MD);
  const cut = APPENDED.exec(md);
  return (cut ? md.slice(0, cut.index) : md).trimEnd() + "\n";
};

const surface = (outcome = "ok", seed = 2) => ({ seed, updates: 3, types: {}, outcome, message: "" });

function passingBlock() {
  return {
    id: "SPIKE_MEASUREMENTS",
    version: 1,
    measuredAt: "2999-01-02T00:00:00Z",
    host: "Paseo desktop 0.11 on Windows 11",
    displayScale: "125%",
    scene: { animatedCharacters: 32, walkingCharacters: 6, zoomMeasured: 3 },
    cadence: { windowSeconds: 30, ticks: 290, medianMs: 100, p95Ms: 120 },
    firstLoadBytes: { 2: 400000, 3: 700000, 4: 1100000 },
    tintBytes: { 2: [50000, 50000, 50000, 50000], 3: [90000, 90000, 90000, 90000], 4: [150000, 150000, 150000, 150000] },
    steadyState: { windowSeconds: 60, bytes: 0 },
    crispness: { 2: true, 3: true, 4: true },
    surfaces: { agents: surface(), workspaces: surface(), projects: surface(), events: surface("ok", null), timeline: surface("error", null) },
    smoothness: { zoom: 3, answer: "yes" },
    zoomLevels: [2, 3, 4],
    tintLevels: 5,
    verdict: "pass",
  };
}

function render(block, options = {}) {
  const { base = originalSpike(), ruleDated = "2026-10-21T07:00:00Z", measured = "2999-01-02T00:00:00Z", desktop = true, rule = true, verdictLine } = options;
  const lines = [base.trimEnd(), ""];
  if (rule) lines.push("## SPIKE_SMOOTHNESS_RULE", "", `Dated: ${ruleDated}`, "", "One question.", "");
  if (block !== null) {
    lines.push("## SPIKE_MEASUREMENTS", "", `Measured: ${measured}`, "", desktop ? DESKTOP_ONLY : "Owner display.", "", "```json", JSON.stringify(block, null, 2), "```", "");
    lines.push("## SPIKE_VERDICT", "", verdictLine ?? `Verdict: ${block.verdict}`, "");
  }
  return lines.join("\n");
}

test("OFFC-10 thresholds: gate rejects an incomplete or inconsistent record", () => {
  const t = thresholds();
  const original = originalSpike();
  const check = (md, first = original) => checkRecord(md, t, first);
  const has = (problems, text) => assert.ok(problems.some((p) => p.includes(text)), `${text} in ${JSON.stringify(problems)}`);
  assert.deepEqual(check(render(passingBlock())), []);
  has(check(render(null)), "no SPIKE_MEASUREMENTS");
  has(check(render(passingBlock(), { measured: "2020-01-01T00:00:00Z" })), "older than the thresholds");
  has(check(render(passingBlock(), { base: original.replace("125 ms", "150 ms") })), "first committed version");
  const failed = { ...passingBlock(), verdict: "fail" };
  has(check(render(failed)), "verdict");
  const broken = (patch, text) => {
    const block = { ...passingBlock(), ...patch };
    has(check(render(block)), text);
  };
  broken({ cadence: { windowSeconds: 30, ticks: 290, medianMs: 130, p95Ms: 120 } }, "cadence median");
  broken({ cadence: { windowSeconds: 30, ticks: 290, medianMs: 100, p95Ms: 260 } }, "cadence p95");
  broken({ firstLoadBytes: { 2: 400000, 3: 700000, 4: 2100000 } }, "first load");
  broken({ steadyState: { windowSeconds: 60, bytes: 60000 } }, "steady state");
  broken({ scene: { animatedCharacters: 31, walkingCharacters: 6, zoomMeasured: 3 } }, "animated");
  broken({ scene: { animatedCharacters: 32, walkingCharacters: 5, zoomMeasured: 3 } }, "walking");
  broken({ crispness: { 2: false, 3: false, 4: false } }, "zoom levels empty");
  broken({ firstLoadBytes: { 2: 400000, 3: 700000, 4: 1900000 }, tintBytes: { 2: [1, 1, 1, 1], 3: [1, 1, 1, 1], 4: [200000, 200000, 200000, 200000] } }, "tint levels");
  broken({ zoomLevels: [2] }, "zoomLevels differ");
  broken({ tintLevels: 3 }, "tintLevels differ");
  has(check(render(passingBlock(), { desktop: false })), "Desktop-only");
  has(check(render(passingBlock(), { rule: false })), "missing SPIKE_SMOOTHNESS_RULE");
  has(check(render(passingBlock(), { ruleDated: "3000-01-01T00:00:00Z" })), "dated after the measurement");
  broken({ smoothness: { zoom: 3, answer: "no" } }, "smoothness answer is no");
  broken({ surfaces: { ...passingBlock().surfaces, agents: surface("error", null) } }, "surface agents");
  broken({ surfaces: { ...passingBlock().surfaces, workspaces: surface("error", null) } }, "surface workspaces");
  broken({ host: "" }, "host is empty");
  for (const patch of [{ smoothness: null }, { surfaces: { ...passingBlock().surfaces, events: surface("not_run", null) } }, { surfaces: { ...passingBlock().surfaces, timeline: surface("pending", null) } }]) {
    has(check(render({ ...passingBlock(), ...patch, verdict: "incomplete" })), "incomplete");
  }
  assert.deepEqual(checkRecord(render(passingBlock()), t, null), []);
});

test("OFFC-10 thresholds: the files agree and the smoothness rule is dated", () => {
  const md = read(SPIKE_MD);
  const json = thresholds();
  const blocks = jsonBlocks(md.slice(0, (APPENDED.exec(md) ?? { index: md.length }).index));
  assert.equal(blocks.length, 1);
  assert.deepEqual(JSON.parse(blocks[0]), json);
  assert.equal(json.id, "SPIKE_THRESHOLDS_JSON");
  assert.match(md, /^## SPIKE_THRESHOLDS$/m);
  const dated = /^Dated: (\S+)$/m.exec(md)?.[1];
  assert.match(dated, ISO);
  const rule = section(md, "SPIKE_SMOOTHNESS_RULE");
  assert.ok(rule !== null, "SPIKE_SMOOTHNESS_RULE section");
  const ruleDated = /^Dated: (\S+)$/m.exec(rule)?.[1];
  assert.match(ruleDated, ISO);
  assert.ok(ruleDated >= dated, "the rule is not dated before the thresholds");
  const first = firstCommitOf(SPIKE_MD);
  if (first !== null) assert.equal(norm(first).trimEnd(), originalSpike().trimEnd(), "the threshold section equals its first committed version");
  const commits = gitOut(["log", "--format=%H", "--", path.relative(ROOT, THRESHOLDS_JSON).split(path.sep).join("/")]);
  if (commits !== null) assert.ok(commits.split("\n").filter(Boolean).length <= 1, "the thresholds JSON has at most one commit");
});

// ---------------------------------------------------------------- spike drawing (guarded)

const guardDraw = spikeExists("server", "art", "spike", "chars.ts") ? test : (name, fn) => test(name, { skip: "spike drawing retired" }, fn);

guardDraw("OFFC-10 spike draw: sheets and layers render at every zoom without a cap error", async () => {
  const { ByteLru, createSpritesHandler, renderSpriteKey } = await load("server", "sprites.ts");
  const { ZOOM_CANDIDATES, sheetSize } = await load("shared", "art-types.ts");
  const { NO_POSES, spriteKey } = await load("shared", "sprites-rpc.ts");
  const { SPIKE_LAYERS } = await load("server", "art", "spike", "rooms.ts");
  const { buildBuilding } = await load("shared", "layout", "building.ts");
  const fresh = () => ({ cache: new ByteLru(50_000_000) });
  const key = (kind, seed, poses, scale, tint = 0) => spriteKey({ kind, seed, poses, scale, tint });
  for (const z of ZOOM_CANDIDATES) {
    const sprite = renderSpriteKey(key("spike-char", "abc", ["stand", "walk"], z), fresh());
    assert.equal(sprite.ok, true);
    assert.deepEqual(sprite.frame, { w: 24 * z, h: 34 * z, cols: 4, rows: 8 });
    assert.deepEqual(pngSize(sprite.uri), { w: 4 * 24 * z, h: 8 * 34 * z });
    assert.equal(renderSpriteKey(key("spike-char", "abc", ["stand", "walk"], z), fresh()).uri, sprite.uri);
    assert.notEqual(renderSpriteKey(key("spike-char", "other", ["stand", "walk"], z), fresh()).uri, sprite.uri);
    const img = decodeUri(sprite.uri);
    const cell = (col, row) => {
      const out = [];
      for (let y = 0; y < 34 * z; y++) out.push(...img.rgba.subarray(((row * 34 * z + y) * img.w + col * 24 * z) * 4, ((row * 34 * z + y) * img.w + (col + 1) * 24 * z) * 4));
      return out;
    };
    assert.equal(img.rgba[3], 0, "corner pixel is transparent");
    assert.ok(cell(2, 0).every((v) => v === 0), "an unused cell of the two-frame pose is transparent");
    assert.notDeepEqual(cell(0, 4), cell(1, 4), "two frames of walk differ");
    for (const seed of Object.keys(SPIKE_LAYERS)) {
      const room = renderSpriteKey(key("spike-room", seed, [], z), fresh());
      assert.equal(room.ok, true, `${seed} at ${z}`);
      assert.deepEqual(pngSize(room.uri), { w: SPIKE_LAYERS[seed].tw * 16 * z, h: SPIKE_LAYERS[seed].th * 16 * z });
    }
    const mean = (uri) => {
      const d = decodeUri(uri).rgba;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
      return sum / (d.length / 4);
    };
    assert.ok(mean(renderSpriteKey(key("spike-room", "room", [], z, 0), fresh()).uri) > mean(renderSpriteKey(key("spike-room", "room", [], z, 4), fresh()).uri));
  }
  const handler = createSpritesHandler();
  const out = handler({ keys: ["spike-room:nowhere:-:2:0", `spike-char:abc:${NO_POSES}:2:0`] });
  assert.equal(out.ok, true);
  for (const sprite of out.sprites) {
    assert.deepEqual([sprite.ok, sprite.code], [false, "render_failed"]);
    assert.doesNotMatch(sprite.message, /\bat\b.*:\d|Error/);
  }
  const six = key("spike-char", "abc", ["stand", "sit", "type", "read", "use", "wait"], 4);
  assert.equal(renderSpriteKey(six, fresh()).ok, true);
  assert.deepEqual(sheetSize(["stand", "sit", "type", "read", "use", "wait"]), { cols: 4, rows: 24 });
  const built = buildBuilding([{ id: "spike-room", slot: 0, seed: 7 }]);
  const rect = (id) => built.areas.find((a) => a.id === id).rect;
  const wanted = { corridor: "core:corridor", room: "room:spike-room", reception: "core:reception", cafe: "core:cafe", lounge: "core:lounge" };
  for (const [seed, id] of Object.entries(wanted)) assert.deepEqual(SPIKE_LAYERS[seed], { tw: rect(id).w, th: rect(id).h }, seed);
});

// ---------------------------------------------------------------- spike hud (guarded)

const guardHud = spikeExists("client", "spike-hud.ts") ? test : (name, fn) => test(name, { skip: "spike hud retired" }, fn);

guardHud("OFFC-10 spike hud: interval statistics ignore bad samples", async () => {
  const { intervalStats } = await load("client", "spike-hud.ts");
  assert.deepEqual(intervalStats([100, 100, 100]), { count: 3, medianMs: 100, p95Ms: 100 });
  assert.equal(intervalStats([10, 20, 30, 40]).medianMs, 25);
  assert.equal(intervalStats(Array.from({ length: 20 }, (_, i) => i + 1)).p95Ms, 19);
  assert.deepEqual(intervalStats([Number.NaN, Infinity, -5, 10]), { count: 1, medianMs: 10, p95Ms: 10 });
  assert.deepEqual(intervalStats([]), { count: 0, medianMs: null, p95Ms: null });
});

guardHud("OFFC-10 spike hud keys: scene keys, tint keys and chunks", async () => {
  const hud = await load("client", "spike-hud.ts");
  const { ByteLru, createSpritesHandler } = await load("server", "sprites.ts");
  const { ZOOM_CANDIDATES } = await load("shared", "art-types.ts");
  const { SPRITE_KEYS_PER_CALL_MAX, SPRITE_KEY_MAX_CHARS, parseSpriteKey } = await load("shared", "sprites-rpc.ts");
  const handler = createSpritesHandler({ cache: new ByteLru(200_000_000) });
  for (const z of ZOOM_CANDIDATES) {
    const keys = hud.sceneKeys(z, 32);
    assert.equal(keys.length, 38);
    assert.equal(new Set(keys).size, 38);
    assert.equal(hud.sceneKeys(z, 3).length, 9);
    for (const k of keys) {
      const spec = parseSpriteKey(k);
      assert.ok(spec && spec.scale === z && k.length <= SPRITE_KEY_MAX_CHARS, k);
    }
    const chars = keys.filter((k) => k.startsWith("spike-char:"));
    chars.forEach((k, i) => assert.equal(parseSpriteKey(k).poses.join("+"), i < hud.SPIKE_WALKING_CHARACTERS ? "stand+walk" : "stand+sit+type+use+read+wait"));
    for (const i of [1, 2, 3, 4]) assert.equal(hud.tintKeys(z, i).length, 5);
    assert.throws(() => hud.tintKeys(z, 0), RangeError);
    assert.throws(() => hud.tintKeys(z, 5), RangeError);
    const all = [...keys, ...[1, 2, 3, 4].flatMap((i) => hud.tintKeys(z, i))];
    for (const chunk of hud.chunkKeys(all)) {
      const out = handler({ keys: chunk });
      assert.equal(out.ok, true);
      for (const sprite of out.sprites) assert.equal(sprite.ok, true, `${sprite.key}: ${sprite.code}`);
    }
  }
  assert.deepEqual(hud.chunkKeys(hud.sceneKeys(2, 32)).map((c) => c.length), [16, 16, 6]);
  assert.deepEqual(hud.chunkKeys([]), []);
  assert.equal(SPRITE_KEYS_PER_CALL_MAX, 16);
});

guardHud("OFFC-10 spike hud log: updates are sanitized, bounded and counted", async () => {
  const { createUpdateLog, logAgentUpdate } = await load("client", "spike-hud.ts");
  const log = createUpdateLog(200, 0);
  const upsert = (agent) => ({ kind: "upsert", agent });
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "idle", labels: {} }), 1000);
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "running", labels: {} }), 12400);
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "running", requiresAttention: true, attentionReason: "finished", labels: {} }), 13000);
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "running", requiresAttention: true, attentionReason: "finished", labels: { "harness.run": "ab12cd34" } }), 14000);
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "running", requiresAttention: true, attentionReason: "finished", labels: { "harness.run": "ab12cd34", "paseo.parent-agent-id": "ff00ee11" } }), 15000);
  logAgentUpdate(log, upsert({ id: "a1b2c3d4e5", status: "running", requiresAttention: true, attentionReason: "finished", labels: { "harness.run": "ab12cd34", "paseo.parent-agent-id": "ff00ee11" } }), 16000);
  assert.deepEqual(log.lines.map((l) => l.replace(/^\+[\d.]+s /, "")), [
    "a1b2c3d4 new status idle",
    "a1b2c3d4 status idle to running",
    "a1b2c3d4 attention none to finished",
    "a1b2c3d4 run=ab12cd34",
    "a1b2c3d4 parent=ff00ee11",
  ]);
  assert.match(log.lines[1], /^\+12\.4s /);
  assert.deepEqual([log.upserts, log.removes, log.quiet, log.malformed], [6, 0, 1, 0]);
  for (const bad of [null, 5, "x", { kind: "upsert" }, { kind: "upsert", agent: { id: "" } }, { kind: "remove" }, { kind: "other" }]) assert.doesNotThrow(() => logAgentUpdate(log, bad, 1));
  assert.equal(log.malformed, 7);
  logAgentUpdate(log, { kind: "remove", agentId: "a1b2c3d4e5" }, 20000);
  assert.equal(log.removes, 1);
  const hostile = createUpdateLog(200, 0);
  logAgentUpdate(hostile, upsert({ id: "x\n`y`" + "z".repeat(10000), status: "idle\nrunning", labels: { "harness.run": "`bad`\n" + "q".repeat(10000) } }), 1);
  assert.ok(hostile.lines.every((l) => l.length <= 160 && !/[`\n\r]/.test(l)));
  const small = createUpdateLog(3, 0);
  for (let i = 0; i < 10; i++) logAgentUpdate(small, upsert({ id: `agent${i}xx`, status: "idle" }), i);
  assert.deepEqual([small.lines.length, small.dropped], [3, 7]);
});

const measurements = (patch = {}) => ({
  animatedCharacters: 32,
  walkingCharacters: 6,
  zoomMeasured: 3,
  cadence: { windowSeconds: 30, ticks: 290, medianMs: 100, p95Ms: 120 },
  firstLoadBytes: { 2: 400000, 3: 700000 },
  tintBytes: { 2: [50000, 50000, 50000, 50000], 3: [90000, 90000, 90000, 90000] },
  steadyState: { windowSeconds: 60, bytes: 0 },
  crispness: { 2: true, 3: true, 4: false },
  surfaces: { agents: surface(), workspaces: surface(), projects: surface(), events: { outcome: "ok", seed: null }, timeline: { outcome: "error", seed: null } },
  smoothness: { zoom: 3, answer: "yes" },
  ...patch,
});

guardHud("OFFC-10 spike hud verdict: each broken input fails its own check and an incomplete record never passes", async () => {
  const hud = await load("client", "spike-hud.ts");
  const t = thresholds();
  assert.deepEqual([hud.SPIKE_LIMITS.cadenceMedianMsMax, hud.SPIKE_LIMITS.cadenceP95MsMax, hud.SPIKE_LIMITS.firstLoadBytesMax, hud.SPIKE_LIMITS.steadyBytesMax], [t.cadence.medianMsMax, t.cadence.p95MsMax, t.firstLoadBytesMax, t.steadyState.bytesMax]);
  assert.ok(hud.SPIKE_TICK_MS <= t.cadence.medianMsMax);
  assert.deepEqual([hud.SPIKE_CADENCE_WINDOW_S, hud.SPIKE_STEADY_WINDOW_S, hud.SPIKE_WALKING_CHARACTERS], [t.cadence.windowSeconds, t.steadyState.windowSeconds, t.walkingCharacters]);
  const ok = hud.evaluateSpike(hud.SPIKE_LIMITS, measurements());
  assert.deepEqual([ok.pass, ok.complete, ok.zoomLevels], [true, true, [2, 3]]);
  assert.ok(ok.tintLevels >= 2);
  assert.ok(Object.values(ok.checks).every((c) => c.ok));
  const broken = (patch, check) => {
    const out = hud.evaluateSpike(hud.SPIKE_LIMITS, measurements(patch));
    assert.equal(out.pass, false, check);
    assert.equal(out.checks[check].ok, false, check);
  };
  broken({ cadence: { windowSeconds: 30, ticks: 1, medianMs: 130, p95Ms: 120 } }, "cadenceMedian");
  broken({ cadence: { windowSeconds: 30, ticks: 1, medianMs: 100, p95Ms: 260 } }, "cadenceP95");
  broken({ firstLoadBytes: { 2: 400000, 3: 2100000 } }, "firstLoad");
  broken({ steadyState: { windowSeconds: 60, bytes: 60000 } }, "steadyState");
  broken({ animatedCharacters: 31 }, "animated");
  broken({ walkingCharacters: 5 }, "walking");
  broken({ crispness: { 2: false, 3: false, 4: false } }, "zoomLevels");
  broken({ firstLoadBytes: { 2: 400000, 3: 1900000 }, tintBytes: { 2: [1, 1, 1, 1], 3: [200000, 1, 1, 1] } }, "tintLevels");
  broken({ surfaces: { ...measurements().surfaces, agents: surface("error", null) } }, "readSurfaces");
  broken({ smoothness: { zoom: 3, answer: "no" } }, "smoothness");
  for (const patch of [{ smoothness: null }, { surfaces: { ...measurements().surfaces, timeline: { outcome: "not_run", seed: null } } }, { surfaces: { ...measurements().surfaces, events: { outcome: "pending", seed: null } } }]) {
    const out = hud.evaluateSpike(hud.SPIKE_LIMITS, measurements(patch));
    assert.deepEqual([out.complete, out.pass], [false, false]);
  }
});

guardHud("OFFC-10 spike surfaces: outcomes are typed, bounded and never throw", async () => {
  const hud = await load("client", "spike-hud.ts");
  assert.deepEqual(hud.SPIKE_SURFACES, ["agents", "workspaces", "projects", "events", "timeline"]);
  assert.deepEqual(hud.SURFACE_ITEM_TYPES, ["todo", "tool_call", "reasoning", "assistant_message", "user_message", "error", "compaction", "other"]);
  const log = hud.createSurfaceLog();
  assert.ok(hud.SPIKE_SURFACES.every((s) => log[s].outcome === "not_run"));
  hud.recordSurface(log, "agents", { outcome: "pending" });
  hud.recordSurface(log, "agents", { outcome: "ok", seed: 4, updates: 2, types: { todo: 1, bogus: 9 } });
  hud.recordSurface(log, "agents", { updates: 3, types: { todo: 2 } });
  assert.deepEqual([log.agents.outcome, log.agents.seed, log.agents.updates, log.agents.types.todo, log.agents.types.other], ["ok", 4, 5, 3, 0]);
  assert.doesNotThrow(() => hud.recordSurface(log, "workspaces", { outcome: "error", message: "`boom`\n" + "x".repeat(10000) }));
  assert.equal(log.workspaces.outcome, "error");
  assert.ok(log.workspaces.message.length <= 80 && !/[`\n]/.test(log.workspaces.message));
  assert.doesNotThrow(() => hud.recordSurface(log, "nope", { outcome: "ok" }));
  assert.doesNotThrow(() => hud.recordSurface(log, "projects", null));
  const summary = hud.summarizeSurfaces(log);
  assert.deepEqual(Object.keys(summary), [...hud.SPIKE_SURFACES]);
  assert.equal(summary.timeline.outcome, "not_run");
  assert.equal(hud.surfaceItemType({ type: "weird" }), "other");
  assert.equal(hud.surfaceItemType({ type: "tool_call" }), "tool_call");
});

// ---------------------------------------------------------------- spike screen (guarded)

const guardScreen = spikeExists("client", "spike-screen.tsx") ? test : (name, fn) => test(name, { skip: "spike screen retired" }, fn);
const READ_ONLY_CALLS = ["agents.list", "agents.subscribe", "workspaces.list", "workspaces.subscribe", "projects.list", "projects.subscribe", "observeEvents", "agents.ref", "timeline.subscribe", "timeline.refetch"];

function fakePaseo(options = {}) {
  const calls = [];
  const live = { agentsList: 0, agents: 0, workspacesList: 0, workspaces: 0, projects: 0, events: 0, timeline: 0 };
  const handlers = { agents: null, workspaces: null, projects: null };
  const release = (name) => async () => {
    live[name] -= 1;
  };
  const sub = (name) => {
    live[name] += 1;
    return { ready: Promise.resolve(), release: release(name) };
  };
  const paseo = {
    agents: {
      list: async () => {
        calls.push("agents.list");
        return { entries: options.entries ?? [{ agent: { id: "aaaaaaaa11", status: "running" } }, { agent: { id: "bbbbbbbb22", status: "idle" } }], subscription: sub("agentsList") };
      },
      subscribe: (handler) => {
        calls.push("agents.subscribe");
        handlers.agents = handler;
        live.agents += 1;
        return () => {
          live.agents -= 1;
        };
      },
      ref: () => {
        calls.push("agents.ref");
        return {
          timeline: {
            subscribe: () => {
              calls.push("timeline.subscribe");
              return Object.assign(() => {}, sub("timeline"));
            },
            refetch: async () => {
              calls.push("timeline.refetch");
              return { entries: [{ item: { type: "tool_call" } }, { item: { type: "weird" } }] };
            },
          },
        };
      },
    },
    workspaces: {
      list: async () => {
        calls.push("workspaces.list");
        if (options.workspacesReject) throw new Error("`workspaces` down\n" + "x".repeat(10000));
        return { entries: [{ id: "w1" }], subscription: sub("workspacesList") };
      },
      subscribe: (handler) => {
        calls.push("workspaces.subscribe");
        handlers.workspaces = handler;
        live.workspaces += 1;
        return () => {
          live.workspaces -= 1;
        };
      },
    },
    projects: {
      list: async () => {
        calls.push("projects.list");
        return { projects: [{ id: "p1" }, { id: "p2" }] };
      },
      subscribe: (handler) => {
        calls.push("projects.subscribe");
        handlers.projects = handler;
        live.projects += 1;
        return () => {
          live.projects -= 1;
        };
      },
    },
    observeEvents: () => {
      calls.push("observeEvents");
      return sub("events");
    },
  };
  return { paseo, calls, live, handlers };
}

const withIntervals = async (body) => {
  const real = [globalThis.setInterval, globalThis.clearInterval];
  const created = [];
  const cleared = [];
  globalThis.setInterval = (fn, ms) => {
    created.push({ fn, ms });
    return created.length;
  };
  globalThis.clearInterval = (id) => {
    cleared.push(id);
  };
  try {
    await body({ created, cleared });
  } finally {
    [globalThis.setInterval, globalThis.clearInterval] = real;
  }
};

guardScreen("OFFC-10 spike screen: one registered screen, tracer without params, spike with view=spike, read-only probes released on unmount", async () => {
  const { fakeHost } = await import("./office-host.mjs");
  const hud = await load("client", "spike-hud.ts");
  const fake = fakePaseo();
  await withIntervals(async ({ created, cleared }) => {
    const host = await fakeHost({ paseo: fake.paseo });
    assert.deepEqual(host.screens.map((s) => s.id), ["office"]);
    assert.deepEqual(host.sidebarItems.map((s) => s.id), ["office"]);
    const tracer = host.mount("office");
    await tracer.flush();
    assert.equal(tracer.find("Image").length, 1);
    assert.equal(host.rpcCalls.length, 1);
    assert.deepEqual(fake.calls, []);
    tracer.unmount();

    const before = host.rpcCalls.length;
    const handle = host.mount("office", { params: { view: hud.SPIKE_VIEW_PARAM } });
    await handle.flush();
    const sprite = host.rpcCalls.slice(before).map((c) => c.input.keys);
    assert.ok(sprite.length > 0 && sprite.every((keys) => keys.length <= 16));
    const asked = sprite.flat();
    for (const key of hud.sceneKeys(2, 32)) assert.ok(asked.includes(key), key);
    assert.equal(new Set(asked).size, asked.length, "no key is requested twice");
    const withId = (type, prefix) => handle.find(type).filter((n) => String(n.props.testID ?? "").startsWith(prefix));
    assert.equal(withId("View", "spike-char-").length, 32);
    assert.equal(withId("Animated.View", "spike-walker-").length, 6);
    assert.equal(withId("Image", "spike-layer-").length, 5);
    assert.equal(withId("Image", "spike-ruler").length, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].ms, hud.SPIKE_TICK_MS);
    const press = async (id) => {
      handle.find("Pressable").find((n) => n.props.testID === id).props.onPress();
      await handle.flush();
    };
    await press("spike-count-3");
    assert.equal(withId("View", "spike-char-").length, 3);
    const seen = host.rpcCalls.length;
    await press("spike-zoom-3");
    const later = host.rpcCalls.slice(seen).flatMap((c) => c.input.keys);
    assert.ok(later.length > 0 && later.every((k) => hud.sceneKeys(3, 3).includes(k) && !asked.includes(k)));
    fake.handlers.agents({ kind: "upsert", agent: { id: "cccccccc33xx", status: "idle", labels: {} } });
    fake.handlers.agents({ kind: "upsert", agent: { id: "aaaaaaaa11", status: "running", labels: {} } });
    await handle.flush();
    const report = () => handle.find("Text").find((n) => n.props.testID === "spike-report").children.join("");
    assert.match(report(), /cccccccc new status idle/);
    assert.match(report(), /Surface agents: ok seeded=2 updates=2/);
    assert.match(report(), /Surface workspaces: ok seeded=1/);
    assert.match(report(), /Surface projects: ok seeded=2/);
    assert.match(report(), /Surface events: ok/);
    assert.match(report(), /Surface timeline: ok seeded=2 .*tool_call:1,other:1/);
    assert.ok(fake.calls.every((c) => READ_ONLY_CALLS.includes(c)), fake.calls.join());
    assert.equal(fake.calls.filter((c) => c === "timeline.subscribe").length, 1);
    handle.unmount();
    assert.deepEqual(fake.live, { agentsList: 0, agents: 0, workspacesList: 0, workspaces: 0, projects: 0, events: 0, timeline: 0 });
    assert.equal(cleared.length, created.length);
    host.dispose();
  });
});

guardScreen("OFFC-10 spike screen: a rejecting surface is recorded as an error and the screen still mounts", async () => {
  const { fakeHost } = await import("./office-host.mjs");
  const hud = await load("client", "spike-hud.ts");
  const fake = fakePaseo({ workspacesReject: true });
  await withIntervals(async () => {
    const host = await fakeHost({ paseo: fake.paseo });
    const handle = host.mount("office", { params: { view: hud.SPIKE_VIEW_PARAM } });
    await handle.flush();
    const text = handle.find("Text").find((n) => n.props.testID === "spike-report").children.join("");
    assert.match(text, /Surface workspaces: error/);
    assert.match(text, /Surface agents: ok/);
    assert.doesNotMatch(text.split("\n").find((l) => l.startsWith("Surface workspaces")), /`/);
    handle.unmount();
    host.dispose();
  });
});

guardScreen("OFFC-10 spike screen: no text literal, no write call, no daemon timer in the source", async () => {
  const src = fs.readFileSync(path.join(OFFICE, "client", "spike-screen.tsx"), "utf8");
  const ts = (await import("node:module")).createRequire(path.join(OFFICE, "package.json"))("typescript");
  const file = ts.createSourceFile("spike-screen.tsx", src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const literals = [];
  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText && node.getText().trim() !== "") literals.push(node.getText().trim());
    if (node.kind === ts.SyntaxKind.JsxExpression && node.expression && ts.isStringLiteralLike(node.expression)) literals.push(node.expression.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.deepEqual(literals, []);
  assert.doesNotMatch(src, /\.(create|open|archive|setTitle|refresh|send|respondToPermission|append|listUsage|run|waitForFinish|commands|detach)\(/);
  assert.equal([...src.matchAll(/setInterval\(/g)].length, 1);
  assert.match(src, /useRpc\(spritesRpc\)/);
  assert.match(src, /findPath\(/);
});

// ---------------------------------------------------------------- the recorded measurement (red until the owner's report is recorded)

const waivedRecord = () => {
  const md = read(SPIKE_MD);
  const waiver = section(md, "SPIKE_WAIVER");
  return waiver !== null && section(md, "SPIKE_MEASUREMENTS") === null ? { md, waiver } : null;
};

test("OFFC-10 waiver: a waived spike is flagged, never reported as a pass", (t) => {
  const w = waivedRecord();
  if (!w) return;
  t.diagnostic("SPIKE WAIVED BY THE OWNER: no measurement is recorded, ZOOM_LEVELS and TINT_LEVELS are provisional and the measurement is still owed");
  assert.doesNotMatch(section(w.md, "SPIKE_VERDICT") ?? "", /^\s*Verdict: pass$/m);
  assert.deepEqual(waiverProblems(w.waiver, /^Dated: (\S+)$/m.exec(w.md)?.[1]), []);
});

test("OFFC-10 waiver: the gate rejects a waiver that is not the owner's, dated, reasoned and provisional, or that stands beside a measurement", () => {
  const dated = "2026-10-21T06:19:51Z";
  const good = [
    "Waived by: owner",
    "Dated: 2099-01-01T00:00:00Z",
    "Reason: the owner skipped the measurement",
    WAIVER_NOT_MEASURED,
    "Measurement owed: yes",
    "Provisional ZOOM_LEVELS: [2, 3]",
    "Provisional TINT_LEVELS: 2",
  ];
  const NL = "\n";
  assert.deepEqual(waiverProblems(good.join(NL), dated), []);
  for (const i of good.keys()) assert.notDeepEqual(waiverProblems(good.filter((_, j) => j !== i).join(NL), dated), [], "without line " + i);
  assert.notDeepEqual(waiverProblems(good.join(NL).replace("2099-01-01T00:00:00Z", "2026-10-21T06:00:00Z"), dated), [], "older than the thresholds");
  assert.notDeepEqual(waiverProblems(good.join(NL).replace("TINT_LEVELS: 2", "TINT_LEVELS: 9"), dated), [], "tint out of range");
  const both = read(SPIKE_MD) + NL + "## SPIKE_MEASUREMENTS" + NL + NL + "Measured: 2099-01-01T00:00:00Z" + NL;
  assert.ok(checkRecord(both, thresholds(), null).some((x) => x.includes("both present")), "waiver and measurement together");
});

const recorded = () => {
  const md = read(SPIKE_MD);
  const block = jsonBlocks(section(md, "SPIKE_MEASUREMENTS") ?? "")[0];
  return { md, block: block ? JSON.parse(block) : null };
};

test("OFFC-10 record: 07-SPIKE.md is complete and consistent", () => {
  const problems = checkRecord(read(SPIKE_MD), thresholds(), firstCommitOf(SPIKE_MD));
  assert.deepEqual(problems, []);
});

test("OFFC-10 verdict: the recorded verdict is pass", () => {
  const w = waivedRecord();
  if (w) return assert.match(section(w.md, "SPIKE_VERDICT") ?? "", /^\s*Verdict: waived by owner, not measured$/m);
  const { md, block } = recorded();
  assert.ok(block, "SPIKE_MEASUREMENTS block");
  const again = recompute(thresholds(), block);
  assert.equal(again.verdict, "pass", JSON.stringify(again.problems));
  assert.equal(block.verdict, again.verdict);
  assert.match(section(md, "SPIKE_VERDICT") ?? "", /^\s*Verdict: pass$/m);
});

test("OFFC-24 scope: desktop only, host and display scale recorded", () => {
  const w = waivedRecord();
  if (w) return assert.match(w.waiver, /^Scope: the owner uses the desktop app and the phone app; no measurement recorded for either$/m);
  const { md, block } = recorded();
  assert.ok(block, "SPIKE_MEASUREMENTS block");
  assert.ok((section(md, "SPIKE_MEASUREMENTS") ?? "").includes(DESKTOP_ONLY));
  assert.ok(block.host.trim() !== "" && block.displayScale.trim() !== "");
});

test("OFFC-10 update log: a run line and at least one status transition line", () => {
  if (waivedRecord()) return assert.ok(waivedRecord().waiver.includes("Update log: not captured"));
  const log = section(read(SPIKE_MD), "SPIKE_UPDATE_LOG") ?? "";
  assert.match(log, /^Run: \S/m);
  assert.match(log, /status \S+ to \S+/);
  assert.equal([...log.matchAll(/^Surface (agents|workspaces|projects|events|timeline): /gm)].length, 5);
});

test("OFFC-10 surfaces: every read surface ran and the agents, workspaces and projects seeds answered without error", () => {
  if (waivedRecord()) return assert.ok(waivedRecord().waiver.includes("Surfaces: not probed"));
  const { block } = recorded();
  assert.ok(block, "SPIKE_MEASUREMENTS block");
  for (const name of ["agents", "workspaces", "projects"]) assert.ok(block.surfaces[name].outcome === "ok" && Number.isFinite(block.surfaces[name].seed), name);
  for (const name of ["events", "timeline"]) assert.ok(["ok", "error"].includes(block.surfaces[name].outcome), name);
});

test("OFFC-10 smoothness: the owner's recorded smoothness answer is yes at the zoom used for cadence", () => {
  if (waivedRecord()) return assert.ok(waivedRecord().waiver.includes("Smoothness: the owner said verbally that everything ran smoothly; no report and no numbers were provided"));
  const { block } = recorded();
  assert.ok(block, "SPIKE_MEASUREMENTS block");
  assert.deepEqual(block.smoothness, { zoom: block.scene.zoomMeasured, answer: "yes" });
});

test("OFFC-09 levels: ZOOM_LEVELS and TINT_LEVELS equal the recorded levels", async () => {
  const w = waivedRecord();
  if (w) {
    const provisional = parseWaiver(w.waiver);
    const art = await load("shared", "art-types.ts");
    const tint = await load("shared", "tint.ts");
    assert.deepEqual([...art.ZOOM_LEVELS], provisional.zoomLevels);
    assert.ok(art.ZOOM_LEVELS.every((z) => art.ZOOM_CANDIDATES.includes(z)));
    assert.equal(tint.TINT_LEVELS, provisional.tintLevels);
    return;
  }
  const { block } = recorded();
  assert.ok(block, "SPIKE_MEASUREMENTS block");
  const art = await load("shared", "art-types.ts");
  const tint = await load("shared", "tint.ts");
  assert.ok(Array.isArray(art.ZOOM_LEVELS) && art.ZOOM_LEVELS.length > 0, "ZOOM_LEVELS");
  assert.deepEqual([...art.ZOOM_LEVELS], [...art.ZOOM_LEVELS].sort((a, b) => a - b));
  assert.ok(art.ZOOM_LEVELS.every((z) => art.ZOOM_CANDIDATES.includes(z)));
  assert.ok(Number.isInteger(tint.TINT_LEVELS) && tint.TINT_LEVELS >= 2 && tint.TINT_LEVELS <= 5, "TINT_LEVELS");
  assert.deepEqual([...art.ZOOM_LEVELS], block.zoomLevels);
  assert.equal(tint.TINT_LEVELS, block.tintLevels);
});
