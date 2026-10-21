import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";
import { fakeHost } from "./office-host.mjs";
import { TINT_LEVELS } from "../../plugins/office/shared/tint.ts";
import { FIXED_DAY_HOUR, ambientAt, dayPhase, fadeLayers, isNeutral, localHour, mixRgb, phaseOf, tintPosition, wrapHour } from "../../plugins/office/client/daylight.ts";
import { SEASONS, seasonFor } from "../../plugins/office/client/season.ts";
import * as L from "../../plugins/office/client/limits-atmosphere.ts";
import {
  CONFETTI_COLORS,
  EMPTY_EFFECT_QUEUE,
  RING_COLORS,
  SPARKLE_COLORS,
  effectFor,
  enqueueEffect,
  finishEffect,
  particlesFor,
} from "../../plugins/office/client/effects.ts";

const CLIENT = path.join(KIT_DIR, "plugins", "office", "client");
const normalise = (text) => text.replace(/\r\n/g, "\n");
const stripComments = (text) => normalise(text).replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const read = (name) => normalise(fs.readFileSync(path.join(CLIENT, name), "utf8"));
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} is not within ${eps} of ${b}`);

// ---- Task 1: day cycle, fade plan, season and limits

test("OFFC-17 daylight phases", () => {
  for (const [hour, phase] of [[0, "predawn"], [4.983, "predawn"], [5, "dawn"], [6.5, "dawn"], [7, "day"], [16.99, "day"], [17, "dusk"], [18.983, "dusk"], [19, "night"], [23.99, "night"]]) {
    assert.equal(phaseOf(hour), phase, String(hour));
  }
  assert.equal(wrapHour(24), 0);
  assert.equal(wrapHour(25.5), 1.5);
  assert.equal(wrapHour(-1), 23);
  assert.equal(wrapHour(NaN), 0);
  assert.equal(phaseOf(-0.5), "night");
  assert.equal(phaseOf(28), "predawn");
});

test("OFFC-17 daylight ambient", () => {
  const noon = ambientAt(12);
  assert.equal(noon.night, 0);
  assert.deepEqual([...noon.outside], [255, 255, 255]);
  assert.deepEqual([...noon.inside], [255, 255, 255]);
  assert.equal(isNeutral(noon), true);
  const late = ambientAt(22.5);
  assert.equal(late.night, 1);
  assert.equal(isNeutral(late), false);
  assert.ok(luminance(late.outside) < 110);
  assert.ok(late.outside[2] - late.outside[0] > 40);
  assert.ok(luminance(late.inside) > 200);
  assert.ok(late.inside[0] > late.inside[2]);
  assert.ok(luminance(late.dim) > luminance(late.outside) && luminance(late.dim) < luminance(late.inside));
  for (const hour of [6.5, 18]) {
    const a = ambientAt(hour);
    assert.ok(a.warm > 0.9, `warm at ${hour}`);
    assert.ok(a.outside[0] - a.outside[2] > 60, `outside at ${hour}`);
  }
  assert.equal(ambientAt(12).warm, 0);
  assert.equal(ambientAt(23).warm, 0);
  assert.equal(ambientAt(4.5).night, 1);
  near(ambientAt(5.9).night, 0.56, 1e-9);
  assert.equal(ambientAt(8).night, 0);
  near(ambientAt(18.6).night, 0.55, 1e-9);
  assert.equal(ambientAt(20).night, 1);
  assert.deepEqual([...mixRgb([0, 0, 0], [255, 255, 255], 0.5)], [128, 128, 128]);
  assert.deepEqual([...mixRgb([10, 20, 30], [200, 210, 220], -4)], [10, 20, 30]);
  assert.deepEqual([...mixRgb([10, 20, 30], [200, 210, 220], 4)], [200, 210, 220]);
});

test("OFFC-17 daylight continuity", () => {
  let prev = ambientAt(17).night;
  for (let m = 1; m <= 180; m++) {
    const n = ambientAt(17 + m / 60).night;
    assert.ok(n >= prev - 1e-12, `night fell at minute ${m}`);
    assert.ok(n - prev < 0.02, `night jumped at minute ${m}`);
    prev = n;
  }
  assert.equal(prev, 1);
  prev = ambientAt(5).night;
  for (let m = 1; m <= 180; m++) {
    const n = ambientAt(5 + m / 60).night;
    assert.ok(n <= prev + 1e-12, `night rose at minute ${m}`);
    prev = n;
  }
  assert.equal(prev, 0);
  assert.deepEqual(ambientAt(24), ambientAt(0));
  const a = ambientAt(23 + 59 / 60);
  const b = ambientAt(0);
  let distance = Math.abs(a.night - b.night) * 255 + Math.abs(a.warm - b.warm) * 255;
  for (let i = 0; i < 3; i++) distance += Math.abs(a.outside[i] - b.outside[i]) + Math.abs(a.inside[i] - b.inside[i]) + Math.abs(a.dim[i] - b.dim[i]);
  assert.ok(distance < 3, `midnight seam ${distance}`);
  assert.ok(luminance(ambientAt(2).outside) < luminance(ambientAt(20).outside));
});

test("OFFC-17 daylight sample", () => {
  const noon = dayPhase(new Date(2026, 9, 21, 12, 0), 4);
  assert.equal(noon.phase, "day");
  assert.equal(noon.night, 0);
  assert.equal(noon.position, 0);
  assert.equal(noon.levels, 4);
  assert.equal(dayPhase(new Date(2026, 9, 21, 22, 30), 4).position, 3);
  const dusk = dayPhase(new Date(2026, 9, 21, 18, 18), 4);
  near(dusk.night, 0.395, 0.001);
  near(dusk.position, 1.185, 0.005);
  for (let h = 0; h < 24; h++) assert.equal(dayPhase(new Date(2026, 9, 21, h, 0), 1).position, 0);
  const dflt = dayPhase(new Date(2026, 9, 21, 22, 30));
  assert.equal(dflt.levels, TINT_LEVELS);
  for (let h = 0; h < 24; h++) assert.ok(dayPhase(new Date(2026, 9, 21, h, 30)).position <= TINT_LEVELS - 1);
  const bad = dayPhase(new Date(NaN), 4);
  assert.equal(bad.hour, FIXED_DAY_HOUR);
  assert.equal(bad.phase, "day");
  assert.equal(bad.position, 0);
  for (const levels of [0, -1, 2.5, NaN, Infinity]) assert.throws(() => dayPhase(new Date(2026, 9, 21, 12), levels), RangeError, String(levels));
  near(localHour(new Date(2026, 9, 21, 14, 45, 0)), 14.75, 1e-9);
  near(localHour(new Date(2026, 9, 21, 13, 0, 36)), 13.01, 1e-9);
  assert.equal(tintPosition(1, 5), 4);
  assert.equal(tintPosition(0.5, 5), 2);
  assert.equal(tintPosition(-3, 5), 0);
  assert.equal(tintPosition(7, 5), 4);
  assert.equal(tintPosition(NaN, 5), 0);
});

test("OFFC-17 fade plan", () => {
  const t = true;
  const f = false;
  const all = [t, t, t, t];
  assert.deepEqual(fadeLayers(0, all), { base: 0, over: null, overOpacity: 0 });
  assert.deepEqual(fadeLayers(1.5, all), { base: 1, over: 2, overOpacity: 0.5 });
  assert.deepEqual(fadeLayers(3, all), { base: 3, over: null, overOpacity: 0 });
  const edge = fadeLayers(2.999, all);
  assert.equal(edge.base, 2);
  assert.equal(edge.over, 3);
  near(edge.overOpacity, 0.999, 0.001);
  assert.equal(fadeLayers(-1, all).base, 0);
  assert.deepEqual(fadeLayers(99, all), { base: 3, over: null, overOpacity: 0 });
  for (const p of [NaN, Infinity, -Infinity]) assert.equal(fadeLayers(p, all).base, 0, String(p));
  assert.deepEqual(fadeLayers(1.5, [t, f, t, t]), { base: 2, over: null, overOpacity: 0 });
  assert.deepEqual(fadeLayers(1.5, [t, t, f, t]), { base: 1, over: null, overOpacity: 0 });
  assert.deepEqual(fadeLayers(1.5, [t, f, f, t]), { base: 0, over: null, overOpacity: 0 });
  assert.deepEqual(fadeLayers(1.5, []), { base: null, over: null, overOpacity: 0 });
  assert.deepEqual(fadeLayers(1.5, [f, f]), { base: null, over: null, overOpacity: 0 });
  for (const p of [0, 1.5, 7]) assert.equal(fadeLayers(p, [t]).base, 0);
  for (let p = 0; p <= 3.0001; p += 0.05) {
    const plan = fadeLayers(p, all);
    const fraction = p - Math.floor(p);
    if (plan.over !== null) {
      assert.ok(fraction > 0);
      assert.ok(plan.overOpacity >= 0 && plan.overOpacity < 1);
      assert.equal(plan.over, plan.base + 1);
    } else {
      assert.equal(plan.overOpacity, 0);
    }
    assert.ok(plan.base !== null);
  }
});

test("OFFC-17 season", () => {
  for (const year of [2024, 2025, 2026]) {
    assert.equal(seasonFor(new Date(year, 8, 30, 23)), "none");
    assert.equal(seasonFor(new Date(year, 9, 1, 0, 0)), "halloween");
    assert.equal(seasonFor(new Date(year, 9, 31, 23)), "halloween");
    assert.equal(seasonFor(new Date(year, 9, 31, 23, 59)), "halloween");
    assert.equal(seasonFor(new Date(year, 10, 1, 0, 0)), "christmas");
    assert.equal(seasonFor(new Date(year, 11, 26, 23)), "christmas");
    assert.equal(seasonFor(new Date(year, 11, 26, 23, 59)), "christmas");
    assert.equal(seasonFor(new Date(year, 11, 27, 0, 0)), "none");
    assert.equal(seasonFor(new Date(year, 0, 1)), "none");
    assert.equal(seasonFor(new Date(year, 6, 15)), "none");
  }
  assert.equal(seasonFor(new Date(NaN)), "none");
  assert.deepEqual([...SEASONS], ["none", "christmas", "halloween"]);
});

test("OFFC-18 limits", () => {
  assert.deepEqual([...L.EFFECT_KINDS], ["wave", "phase"]);
  const positiveInt = (n) => Number.isInteger(n) && n > 0;
  for (const name of ["EFFECT_PARTICLES", "EFFECT_SPARKLES", "EFFECT_DURATION_MS", "EFFECT_SPREAD_PX", "EFFECT_RISE_PX", "EFFECT_FALL_PX", "EFFECT_RING_PX"]) {
    assert.deepEqual(Object.keys(L[name]).sort(), [...L.EFFECT_KINDS].sort(), name);
    for (const kind of L.EFFECT_KINDS) assert.ok(positiveInt(L[name][kind]), `${name}.${kind}`);
  }
  for (const name of ["EFFECT_PARTICLES", "EFFECT_SPREAD_PX", "EFFECT_DURATION_MS"]) assert.ok(L[name].phase > L[name].wave, name);
  for (const name of ["EFFECT_MAX_ACTIVE", "EFFECT_ID_MAX_CHARS", "EFFECT_PHASE_MAX_CHARS", "EFFECT_WAVE_MAX", "EFFECT_PLANS_MAX", "EFFECT_PARTICLE_PX", "EFFECT_SPARKLE_PX", "EFFECT_SPIN_DEG", "EFFECT_ZOOM_FALLBACK"]) {
    assert.ok(positiveInt(L[name]), name);
  }
  for (const name of ["EFFECT_RISE_AT", "EFFECT_FADE_FROM", "EFFECT_RING_START_SCALE"]) assert.ok(typeof L[name] === "number" && L[name] > 0 && L[name] < 1, name);
  assert.ok(L.EFFECT_RISE_AT < L.EFFECT_FADE_FROM);
});

// ---- Task 2: effect rules, particles and the queue

const reading = (done, total, over = {}) => ({ phase: "07", wave: 1, plansDone: done, plansTotal: total, scope: "complete", ...over });

test("OFFC-18 effects transitions", () => {
  assert.deepEqual(effectFor(reading(2, 3), reading(3, 3)), { id: "wave:07:1", kind: "wave", phase: "07", wave: 1 });
  assert.deepEqual(effectFor(reading(5, 6, { wave: null }), reading(6, 6, { wave: null })), { id: "phase:07:all", kind: "phase", phase: "07", wave: null });
  assert.equal(effectFor(reading(2, 3, { phase: "02.1", wave: 2 }), reading(3, 3, { phase: "02.1", wave: 2 })).id, "wave:02.1:2");
  assert.ok(effectFor(reading(0, 3), reading(3, 3)));
  assert.ok(effectFor(reading(2, 3), reading(4, 4)));
  const nulls = [
    [null, reading(3, 3)],
    [undefined, reading(3, 3)],
    [reading(2, 3), null],
    [reading(3, 3), reading(3, 3)],
    [reading(1, 3), reading(2, 3)],
    [reading(3, 3), reading(2, 3)],
    [reading(2, 3), reading(2, 3)],
    [reading(2, 3, { wave: 1 }), reading(3, 3, { wave: 2 })],
    [reading(2, 3, { phase: "07" }), reading(3, 3, { phase: "08" })],
    [reading(2, 3, { wave: null }), reading(3, 3, { wave: 1 })],
    [reading(2, 3, { scope: "unreadable" }), reading(3, 3)],
    [reading(2, 3), reading(3, 3, { scope: "unreadable" })],
    [reading(null, null, { scope: "unreadable" }), reading(null, null, { scope: "unreadable" })],
    [reading(2, 3, { scope: "truncated" }), reading(3, 3)],
    [reading(2, 3), reading(3, 3, { scope: "truncated" })],
  ];
  for (const [prev, next] of nulls) assert.equal(effectFor(prev, next), null, JSON.stringify([prev, next]));
  const a = effectFor(reading(2, 3), reading(3, 3));
  const b = effectFor(reading(2, 3), reading(3, 3));
  assert.deepEqual(a, b);
  assert.notEqual(a, b);
});

test("OFFC-18 effects hostile input", () => {
  const good = reading(2, 3);
  const goodNext = reading(3, 3);
  const throwing = { phase: "07", wave: 1, plansTotal: 3, scope: "complete", get plansDone() { throw new Error("boom"); } };
  const proxy = new Proxy({}, { get() { throw new Error("boom"); }, has() { throw new Error("boom"); }, ownKeys() { throw new Error("boom"); } });
  const hostile = [null, undefined, "x", 7, [], {}, [good], throwing, proxy];
  for (const h of hostile) {
    assert.equal(effectFor(h, goodNext), null);
    assert.equal(effectFor(good, h), null);
    assert.equal(effectFor(h, h), null);
  }
  assert.equal(effectFor(Object.freeze({ ...good }), proxy), null);
  const badPhases = ["../x", "", "07 ", "07/1", "a", "1234567890.123456", "07..1", ".07", "07."];
  for (const phase of badPhases) assert.equal(effectFor(reading(2, 3, { phase }), reading(3, 3, { phase })), null, JSON.stringify(phase));
  for (const wave of [-1, 1.5, "1", 1000, NaN, Infinity]) assert.equal(effectFor(reading(2, 3, { wave }), reading(3, 3, { wave })), null, String(wave));
  for (const total of [0, 1000, -1, NaN, Infinity]) assert.equal(effectFor(reading(0, total), reading(total, total)), null, String(total));
  for (const done of [4, -1, 1.5, "3", NaN]) assert.equal(effectFor(good, reading(done, 3)), null, String(done));
  for (const scope of ["complete ", 5, "Complete", ""]) assert.equal(effectFor(reading(2, 3, { scope }), reading(3, 3, { scope })), null, String(scope));
});

test("OFFC-18 effects ids", () => {
  const phase = "123456789.1234.1";
  assert.equal(phase.length, 16);
  const spec = effectFor(reading(1, 2, { phase, wave: 999 }), reading(2, 2, { phase, wave: 999 }));
  assert.equal(spec.id, "wave:123456789.1234.1:999");
  assert.ok(spec.id.length <= L.EFFECT_ID_MAX_CHARS);
  const long = `${phase}1`;
  assert.equal(effectFor(reading(1, 2, { phase: long, wave: 999 }), reading(2, 2, { phase: long, wave: 999 })), null);
  for (const [prev, next] of [[reading(1, 2), reading(2, 2)], [reading(1, 2, { wave: null }), reading(2, 2, { wave: null })], [reading(1, 2, { wave: 0 }), reading(2, 2, { wave: 0 })]]) {
    const e = effectFor(prev, next);
    assert.equal(e.id, `${e.kind}:${e.phase}:${e.wave === null ? "all" : e.wave}`);
    assert.match(e.id, /^(wave|phase):[0-9.]+:([0-9]+|all)$/);
  }
});

function fnv(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

test("OFFC-18 effects particles", () => {
  for (const kind of L.EFFECT_KINDS) {
    const list = particlesFor({ id: `${kind}:07:1`, kind });
    assert.equal(list.length, L.EFFECT_PARTICLES[kind] + L.EFFECT_SPARKLES[kind]);
    list.forEach((p, i) => {
      for (const key of ["dx", "rise", "fall", "spin", "size"]) assert.ok(Number.isInteger(p[key]), `${key} of ${i}`);
      if (i < L.EFFECT_PARTICLES[kind]) {
        assert.equal(p.shape, "confetti");
        assert.ok(Math.abs(p.dx) <= L.EFFECT_SPREAD_PX[kind]);
        assert.ok(p.rise >= 1 && p.rise <= L.EFFECT_RISE_PX[kind]);
        assert.ok(p.fall >= 1 && p.fall <= L.EFFECT_FALL_PX[kind]);
        assert.ok(Math.abs(p.spin) <= L.EFFECT_SPIN_DEG);
        assert.equal(p.size, L.EFFECT_PARTICLE_PX);
        assert.ok(CONFETTI_COLORS.includes(p.color));
      } else {
        assert.equal(p.shape, "sparkle");
        assert.equal(p.size, L.EFFECT_SPARKLE_PX);
        assert.equal(p.fall, -p.rise);
        assert.ok(p.rise >= 1);
        assert.equal(p.spin, 0);
        assert.ok(SPARKLE_COLORS.includes(p.color));
      }
    });
  }
  const one = particlesFor({ id: "wave:07:1", kind: "wave" });
  const two = particlesFor({ id: "wave:07:1", kind: "wave" });
  assert.deepEqual(one, two);
  assert.notEqual(one, two);
  assert.notDeepEqual(one, particlesFor({ id: "wave:07:2", kind: "wave" }));
  assert.deepEqual([...CONFETTI_COLORS], ["#ff4d6d", "#ffb11f", "#ffe14d", "#3ddc84", "#3fa7ff", "#b06bff", "#ff7ad9"]);
  assert.deepEqual([...SPARKLE_COLORS], ["#ffffff", "#fff3a6", "#ffd1f0", "#bfe9ff"]);
  assert.deepEqual(Object.keys(RING_COLORS).sort(), ["phase", "wave"]);
  for (const color of Object.values(RING_COLORS)) assert.ok(CONFETTI_COLORS.includes(color));
  assert.deepEqual(particlesFor({ id: "x", kind: "nope" }), []);
  assert.deepEqual(particlesFor({ id: 5, kind: "wave" }), []);
  assert.ok(particlesFor({ id: "z".repeat(10000), kind: "phase" }).length > 0);
  // Golden hash of the wave:07:1 burst, computed once from the implemented formulas and reviewed against them.
  assert.equal(fnv(JSON.stringify(one)), 0x3bc603f4);
});

test("OFFC-18 effects queue", () => {
  const place = (id, over = {}) => Object.freeze({ id, kind: "wave", x: 1, y: 2, ...over });
  const frozen = EMPTY_EFFECT_QUEUE;
  const q1 = enqueueEffect(frozen, place("a"));
  assert.notEqual(q1, frozen);
  assert.equal(q1.active.length, 1);
  assert.equal(enqueueEffect(q1, place("a")), q1);
  for (const bad of [place("b", { x: NaN }), place("b", { y: Infinity }), place("b", { kind: "nope" }), place("", {}), place("x".repeat(L.EFFECT_ID_MAX_CHARS + 1)), null, "s"]) {
    assert.equal(enqueueEffect(q1, bad), q1);
  }
  let q = frozen;
  for (const id of ["a", "b", "c", "d"]) q = enqueueEffect(q, place(id));
  assert.deepEqual(q.active.map((p) => p.id), ["b", "c", "d"]);
  assert.deepEqual(enqueueEffect(enqueueEffect(frozen, place("a"), 1), place("b"), 1).active.map((p) => p.id), ["b"]);
  for (const cap of [0, 1.5, NaN]) assert.throws(() => enqueueEffect(frozen, place("a"), cap), RangeError, String(cap));
  assert.equal(finishEffect(q, "zzz"), q);
  assert.deepEqual(finishEffect(q, "c").active.map((p) => p.id), ["b", "d"]);
  const extra = enqueueEffect(frozen, { id: "e", kind: "phase", x: 3, y: 4, junk: true });
  assert.deepEqual(Object.keys(extra.active[0]).sort(), ["id", "kind", "x", "y"]);
  assert.deepEqual(frozen.active, []);
});

// ---- Task 3: mounted components and source rules

const walk = (node, visit) => {
  if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
  else if (node && typeof node === "object") {
    visit(node);
    walk(node.children, visit);
  }
};
const nodesOf = (handle) => {
  const out = [];
  walk(handle.tree, (n) => out.push(n));
  return out;
};
const byPrefix = (handle, prefix) => nodesOf(handle).filter((n) => typeof n.props?.testID === "string" && n.props.testID.startsWith(prefix));
const byId = (handle, id) => nodesOf(handle).filter((n) => n.props?.testID === id);

// Every string value in a props tree, cycle-safe.
function strings(value, seen = new Set(), out = []) {
  if (typeof value === "string") out.push(value);
  else if (value && typeof value === "object" && !seen.has(value)) {
    seen.add(value);
    if (value instanceof Map || value instanceof Set) return out;
    for (const v of Object.values(value)) strings(v, seen, out);
  }
  return out;
}

test("OFFC-17 tint component", async () => {
  const host = await fakeHost();
  try {
    const sources = [{ uri: "data:a" }, { uri: "data:b" }, { uri: "data:c" }, { uri: "data:d" }];
    const props = { sources, position: 1.5, width: 40, height: 30 };
    const h = host.mountModule("client/atmosphere.tsx", "TintFade", props);
    const root = h.tree;
    assert.equal(root.props.testID, "office-tint");
    assert.equal(root.props.style.width, 40);
    assert.equal(root.props.style.height, 30);
    assert.equal(root.props.style.pointerEvents, "none");
    const images = h.find("Image");
    assert.deepEqual(images.map((n) => n.props.testID), ["office-tint-1", "office-tint-2"]);
    assert.ok(images[0].props.style.opacity === undefined || images[0].props.style.opacity === 1);
    assert.equal(images[1].props.style.opacity, 0.5);
    images.forEach((n, i) => {
      assert.equal(n.props.source, sources[i + 1]);
      const { position, left, top, width, height } = n.props.style;
      assert.deepEqual({ position, left, top, width, height }, { position: "absolute", left: 0, top: 0, width: 40, height: 30 });
      assert.equal("resizeMode" in n.props, false);
    });
    assert.equal(h.find("Text").length, 0);
    h.rerender({ ...props, position: 0 });
    assert.deepEqual(h.find("Image").map((n) => n.props.testID), ["office-tint-0"]);
    h.rerender({ ...props, position: NaN });
    assert.deepEqual(h.find("Image").map((n) => n.props.testID), ["office-tint-0"]);
    h.rerender({ ...props, position: 99 });
    assert.deepEqual(h.find("Image").map((n) => n.props.testID), ["office-tint-3"]);
    h.rerender({ ...props, sources: [sources[0], null, sources[2], sources[3]] });
    assert.deepEqual(h.find("Image").map((n) => n.props.testID), ["office-tint-2"]);
    h.rerender({ ...props, position: 2.5 });
    assert.deepEqual(h.find("Image").map((n) => n.props.testID), ["office-tint-2", "office-tint-3"]);
    for (const empty of [{ ...props, sources: [null, null] }, { ...props, sources: [] }, { ...props, width: 0 }, { ...props, width: NaN }, { ...props, height: -4 }]) {
      h.rerender(empty);
      assert.deepEqual(h.tree, []);
    }
  } finally {
    host.dispose();
  }
});

test("OFFC-18 effect component", async () => {
  const host = await fakeHost();
  try {
    const wave = (id, x = 100, y = 50) => ({ id, kind: "wave", x, y });
    const base = { zoom: 3, onDone: () => {} };
    const h = host.mountModule("client/effects.tsx", "EffectLayer", { ...base, effects: [] });
    assert.deepEqual(h.tree, []);
    h.rerender({ ...base, effects: [wave("wave:07:1")] });
    const burst = byId(h, "office-fx-burst-0");
    assert.equal(burst.length, 1);
    assert.equal(burst[0].props.style.left, 100);
    assert.equal(burst[0].props.style.top, 50);
    assert.equal(byPrefix(h, "office-fx-ring-").length, 1);
    const particles = byPrefix(h, "office-fx-particle-");
    assert.equal(particles.length, L.EFFECT_PARTICLES.wave + L.EFFECT_SPARKLES.wave);
    particles.forEach((n, i) => {
      const size = i < L.EFFECT_PARTICLES.wave ? L.EFFECT_PARTICLE_PX * 3 : L.EFFECT_SPARKLE_PX * 3;
      assert.equal(n.props.style.width, size);
      assert.equal(n.props.style.height, size);
    });
    h.rerender({ ...base, effects: [{ id: "phase:07:all", kind: "phase", x: 1, y: 2 }] });
    assert.equal(byPrefix(h, "office-fx-particle-").length, L.EFFECT_PARTICLES.phase + L.EFFECT_SPARKLES.phase);
    h.rerender({ ...base, effects: ["a", "b", "c", "d", "e"].map((id) => wave(id)) });
    assert.equal(byPrefix(h, "office-fx-burst-").length, L.EFFECT_MAX_ACTIVE);
    h.rerender({ ...base, effects: [wave("a"), wave("a"), wave("b")] });
    assert.equal(byPrefix(h, "office-fx-burst-").length, 2);
    const sizeAt = (zoom) => {
      h.rerender({ ...base, zoom, effects: [wave("wave:07:1")] });
      return byPrefix(h, "office-fx-particle-").map((n) => [n.props.style.width, n.props.style.height]);
    };
    const one = sizeAt(1);
    for (const z of [0, NaN, -2]) assert.deepEqual(sizeAt(z), one, String(z));
    assert.equal(h.find("Text").length, 0);

    const done = [];
    const quick = host.mountModule("client/effects.tsx", "EffectLayer", { effects: [wave("wave:07:1"), wave("wave:07:2")], zoom: 2, onDone: (id) => done.push(id), durationMs: { wave: 0, phase: 0 } });
    await quick.flush();
    assert.deepEqual([...done].sort(), ["wave:07:1", "wave:07:2"]);
    quick.rerender({ effects: [wave("wave:07:1"), wave("wave:07:2")], zoom: 2, onDone: (id) => done.push(id), durationMs: { wave: 0, phase: 0 } });
    await quick.flush();
    assert.equal(done.length, 2);
    const slow = [];
    const normal = host.mountModule("client/effects.tsx", "EffectLayer", { effects: [wave("wave:07:1")], zoom: 2, onDone: (id) => slow.push(id) });
    await normal.flush();
    assert.deepEqual(slow, []);
    normal.unmount();

    const hostile = `javascript:"<img src=x onerror=1>"'${"&".repeat(40)}${"q7".repeat(5000)}`;
    const evil = host.mountModule("client/effects.tsx", "EffectLayer", { effects: [{ id: hostile, kind: "wave", x: 1, y: 1 }], zoom: 1, onDone: () => {} });
    assert.ok(byPrefix(evil, "office-fx-particle-").length > 0);
    const slice = hostile.slice(40, 60);
    for (const text of strings(evil.tree)) assert.equal(text.includes(slice), false, text.slice(0, 40));
    assert.equal(evil.find("Text").length, 0);
    evil.unmount();
    h.unmount();
  } finally {
    host.dispose();
  }
});

const ATMOSPHERE_FILES = ["daylight.ts", "season.ts", "effects.ts", "limits-atmosphere.ts", "atmosphere.tsx", "effects.tsx"];
const ALLOWED_IMPORTS = {
  "daylight.ts": ["../shared/tint.ts"],
  "season.ts": [],
  "effects.ts": ["./limits-atmosphere.ts"],
  "limits-atmosphere.ts": [],
  "atmosphere.tsx": ["react-native", "./daylight.ts"],
  "effects.tsx": ["react", "react-native", "./effects.ts", "./limits-atmosphere.ts"],
};

test("OFFC-17 sources", () => {
  const forbidden = [
    /setInterval|setTimeout|Date\.now|new Date\(|Math\.random|fetch\(|listUsage|usePaseo|useRpc|readFile|StyleSheet/,
    /child_process/,
    /\b(writeFile|appendFile|mkdir|rmdir|unlink|rename|copyFile|symlink|createWriteStream|chmod|truncate|utimes|cp|rm)(Sync)?\s*\(/,
    /\.(send|run|archive|create|respondToPermission|setTitle|setModel|cancel|detach|append|waitForFinish)\s*\(/,
    /\b(spawnProcess|execCommand|terminateProcess)\b/,
  ];
  for (const file of ATMOSPHERE_FILES) {
    const code = stripComments(fs.readFileSync(path.join(CLIENT, file), "utf8"));
    for (const re of forbidden) assert.doesNotMatch(code, re, `${file}: ${re}`);
    assert.doesNotMatch(code, /\benum\s+\w|\bnamespace\s+\w|constructor\s*\(\s*(public|private|protected|readonly)\b/, file);
    const specs = [...code.matchAll(/(?:from|import)\s+["']([^"']+)["']/g)].map((m) => m[1]);
    for (const spec of specs) assert.ok(ALLOWED_IMPORTS[file].includes(spec), `${file}: import ${spec}`);
    if (file.endsWith(".tsx")) {
      assert.doesNotMatch(code, /<Text\b|<div\b|<span\b|<svg\b|\bdocument\.|\bwindow\.|canvas/i, file);
    }
    if (file !== "limits-atmosphere.ts") assert.doesNotMatch(code, /export\s+(?:const|function|type|interface|class)\s+EFFECT_/, `${file} declares an EFFECT_ export`);
  }
  for (const [file, upstream] of [
    ["daylight.ts", "client/src/world/render/daylight.ts"],
    ["season.ts", "client/src/world/api.ts"],
    ["effects.ts", "client/src/world/render/particles.ts"],
  ]) {
    assert.ok(read(file).startsWith(`// Port of habblaud ${upstream} @ faa1a012b5fbf632c66dc6801c5383e53a542406`), file);
  }
  assert.match(read("limits-atmosphere.ts"), /export const EFFECT_MAX_ACTIVE/);
});
