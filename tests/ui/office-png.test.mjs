import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import zlib from "node:zlib";
import { PixelBuf } from "../../plugins/office/server/art/core/pixbuf.ts";
import { PNG_MAX_DIMENSION } from "../../plugins/office/server/limits.ts";
import { crc32, encodePng } from "../../plugins/office/server/png.ts";
import { RULER_COLORS, RULER_H, RULER_W, SPRITE_REGISTRY } from "../../plugins/office/server/sprite-registry.ts";
import { ByteLru, createSpritesHandler, renderSpriteKey } from "../../plugins/office/server/sprites.ts";
import { POSE_NAMES, ZOOM_CANDIDATES } from "../../plugins/office/shared/art-types.ts";
import { SPRITE_KEYS_PER_CALL_MAX, SPRITE_KEY_MAX_CHARS, SPRITE_SEED_MAX_CHARS, parseSpriteKey, spriteKey, spritesRpc } from "../../plugins/office/shared/sprites-rpc.ts";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakeHost } from "./office-host.mjs";

const PINNED_COMMIT = "faa1a012b5fbf632c66dc6801c5383e53a542406";
const RULER_SHA256 = "0b26a26b030c58cfa6d592e16d0d0ef56fa46598cbf079ceab61a7f604b8b42b";
const OFFICE = path.join(KIT_DIR, "plugins", "office");
const normalise = (text) => text.replace(/\r\n/g, "\n");

// Deterministic pseudo-random RGBA (linear congruential generator).
function randomRgba(w, h, seed = 12345) {
  const out = new Uint8Array(w * h * 4);
  let s = seed;
  for (let i = 0; i < out.length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

// Independent PNG reader: chunk walk, CRC check against zlib.crc32, inflate, filter byte 0 only.
function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let pos = 8;
  const types = [];
  const idat = [];
  let ihdr = null;
  while (pos < png.length) {
    const length = png.readUInt32BE(pos);
    const type = png.toString("ascii", pos + 4, pos + 8);
    const data = png.subarray(pos + 8, pos + 8 + length);
    assert.equal(png.readUInt32BE(pos + 8 + length), zlib.crc32(png.subarray(pos + 4, pos + 8 + length)), `crc of ${type}`);
    types.push(type);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    pos += 12 + length;
  }
  assert.equal(pos, png.length);
  assert.deepEqual([types[0], types.at(-1)], ["IHDR", "IEND"]);
  const w = ihdr.readUInt32BE(0);
  const h = ihdr.readUInt32BE(4);
  assert.deepEqual([ihdr[8], ihdr[9]], [8, 6]);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, (w * 4 + 1) * h);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    assert.equal(raw[y * (w * 4 + 1)], 0, "filter byte 0");
    rgba.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
  }
  return { w, h, rgba, types };
}

const decodeUri = (uri) => {
  assert.ok(uri.startsWith("data:image/png;base64,"));
  return decodePng(Buffer.from(uri.slice("data:image/png;base64,".length), "base64"));
};

// Independent pixel-by-pixel nearest-neighbour reference.
function upscaleRef(rgba, w, h, s) {
  const out = new Uint8Array(w * s * h * s * 4);
  for (let y = 0; y < h * s; y++) {
    for (let x = 0; x < w * s; x++) {
      const src = (Math.floor(y / s) * w + Math.floor(x / s)) * 4;
      out.set(rgba.subarray(src, src + 4), (y * w * s + x) * 4);
    }
  }
  return out;
}

const rulerRgba = () => SPRITE_REGISTRY.ruler({ kind: "ruler", seed: "abc", poses: [], scale: 2, tint: 0 }).buf.data;

test("OFFC-08 PNG: signature, IHDR, every chunk CRC and the inflated rows equal the input RGBA", () => {
  const rgba = randomRgba(13, 7);
  const decoded = decodePng(encodePng(rgba, 13, 7));
  assert.deepEqual([decoded.w, decoded.h], [13, 7]);
  assert.deepEqual(decoded.types, ["IHDR", "IDAT", "IEND"]);
  assert.deepEqual(decoded.rgba, rgba);
});

test("OFFC-08 PNG: crc32 matches zlib.crc32", () => {
  assert.equal(crc32(new Uint8Array(0)), zlib.crc32(Buffer.alloc(0)));
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
  const big = Buffer.from(randomRgba(10, 25, 99)).subarray(0, 1000);
  assert.equal(big.length, 1000);
  assert.equal(crc32(big), zlib.crc32(big));
});

test("OFFC-09 PNG: integer upscale at each ZOOM_CANDIDATES entry equals an independent pixel-by-pixel nearest-neighbour reference", () => {
  const rgba = randomRgba(5, 4, 7);
  for (const s of ZOOM_CANDIDATES) {
    const decoded = decodePng(encodePng(rgba, 5, 4, s));
    assert.deepEqual([decoded.w, decoded.h], [5 * s, 4 * s]);
    assert.deepEqual(decoded.rgba, upscaleRef(rgba, 5, 4, s), `scale ${s}`);
  }
});

test("OFFC-08 tracer: the registered office screen shows the ruler sprite", async () => {
  const host = await fakeHost();
  assert.ok(host.screens.some((s) => s.id === "office"));
  assert.ok(host.sidebarItems.some((s) => s.id === "office"));
  const handle = host.mountModule("client/tracer-screen.tsx", "TracerScreen", host.screenProps());
  await handle.flush();
  const images = handle.find("Image");
  assert.equal(images.length, 1);
  const source = images[0].props.source;
  const decoded = decodeUri(source.uri);
  const scale = ZOOM_CANDIDATES[0];
  assert.deepEqual(decoded.rgba, upscaleRef(rulerRgba(), RULER_W, RULER_H, scale));
  assert.deepEqual([images[0].props.style.width, images[0].props.style.height], [decoded.w, decoded.h]);
  assert.equal(host.rpcCalls.length, 1);
  handle.rerender(host.screenProps());
  handle.unmount();
  const again = host.mountModule("client/tracer-screen.tsx", "TracerScreen", host.screenProps());
  await again.flush();
  assert.equal(host.rpcCalls.length, 1);
  assert.equal(again.find("Image")[0].props.source, source);
  host.dispose();
  assert.ok(host.cleanups.length >= 3 && host.cleanups.every((c) => c.ran));
});

test("OFFC-03 PNG: bad sizes and the dimension and pixel caps throw RangeError", () => {
  const px = new Uint8Array(4);
  for (const scale of [0, 1.5, -1, Number.NaN]) assert.throws(() => encodePng(px, 1, 1, scale), RangeError, `scale ${scale}`);
  assert.throws(() => encodePng(new Uint8Array(0), 0, 1), RangeError);
  assert.throws(() => encodePng(new Uint8Array(0), 1, 0), RangeError);
  assert.throws(() => encodePng(px, 1, 1.5), RangeError);
  assert.throws(() => encodePng(px, 2, 1), RangeError);
  assert.throws(() => encodePng(px, 1, 1, PNG_MAX_DIMENSION + 1), RangeError);
  assert.throws(() => encodePng(new Uint8Array(1000 * 1000 * 4), 1000, 1000, 3), RangeError);
  assert.ok(encodePng(px, 1, 1, PNG_MAX_DIMENSION / 4).length > 0);
});

test("OFFC-08 LRU: evicts least recently used entries at the byte cap", () => {
  const lru = new ByteLru(10);
  lru.set("a", "A", 4);
  lru.set("b", "B", 4);
  assert.equal(lru.get("a"), "A");
  lru.set("c", "C", 4);
  assert.equal(lru.get("b"), undefined);
  assert.deepEqual([lru.get("a"), lru.get("c")], ["A", "C"]);
  assert.deepEqual([lru.size, lru.bytes], [2, 8]);
  lru.set("huge", "H", 11);
  assert.equal(lru.get("huge"), undefined);
  assert.equal(lru.bytes, 8);
  lru.set("a", "A2", 2);
  assert.deepEqual([lru.get("a"), lru.bytes], ["A2", 6]);
  assert.ok(lru.delete("a"));
  assert.equal(lru.bytes, 4);
  lru.clear();
  assert.deepEqual([lru.size, lru.bytes], [0, 0]);
});

test("OFFC-08 cache: the same canonical key renders once", () => {
  let calls = 0;
  const deps = { registry: { ruler: (spec) => (calls++, SPRITE_REGISTRY.ruler(spec)) }, cache: new ByteLru(1_000_000) };
  const first = renderSpriteKey("ruler:abc:-:2:0", deps);
  const second = renderSpriteKey("ruler:abc:-:2:0", deps);
  assert.equal(first.ok, true);
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test("OFFC-03 handler: input shapes, key cap and duplicate keys", () => {
  const handle = createSpritesHandler();
  assert.deepEqual(handle({ keys: [] }), { ok: true, sprites: [] });
  for (const bad of [null, undefined, 5, "keys", {}, { keys: "x" }, { keys: [1] }, { keys: [null] }, { keys: {} }]) {
    const out = handle(bad);
    assert.deepEqual([out.ok, out.code], [false, "bad_input"], JSON.stringify(bad));
  }
  const key = "ruler:abc:-:2:0";
  assert.equal(handle({ keys: Array(SPRITE_KEYS_PER_CALL_MAX).fill(key) }).ok, true);
  assert.equal(handle({ keys: Array(SPRITE_KEYS_PER_CALL_MAX + 1).fill(key) }).code, "too_many_keys");
  let calls = 0;
  const counting = createSpritesHandler({ registry: { ruler: (spec) => (calls++, SPRITE_REGISTRY.ruler(spec)) }, cache: new ByteLru(1_000_000) });
  const out = counting({ keys: [key, key, "ruler:xyz:-:3:1", key] });
  assert.equal(calls, 2);
  assert.equal(out.sprites.length, 4);
  assert.deepEqual(out.sprites[0], out.sprites[3]);
  assert.equal(out.sprites[2].scale, 3);
});

test("OFFC-03 keys: bad grammar gives a per-key bad_key and canonical keys round-trip", () => {
  const bad = [
    "nope:abc:-:2:0",
    "ruler:a:b:-:2:0",
    `ruler:${"a".repeat(SPRITE_SEED_MAX_CHARS + 1)}:-:2:0`,
    "ruler:abc:-:1:0",
    "ruler:abc:-:5:0",
    "ruler:abc:-:2.5:0",
    "ruler:abc:-:2:5",
    "ruler:abc:walk+walk:2:0",
    "ruler:abc:fly:2:0",
    "ruler:abc:walk+stand:2:0",
    "ruler:ab c:-:2:0",
    "ruler::-:2:0",
    `ruler:${"a".repeat(200)}:-:2:0`,
    "",
  ];
  const handle = createSpritesHandler();
  const out = handle({ keys: bad });
  assert.equal(out.ok, true);
  out.sprites.forEach((sprite, i) => {
    assert.deepEqual([sprite.ok, sprite.code], [false, "bad_key"], bad[i]);
    assert.equal(sprite.key, bad[i].slice(0, SPRITE_KEY_MAX_CHARS));
  });
  for (const k of ["ruler:abc:-:2:0", "ruler:a_b-c:stand+walk:3:4"]) assert.equal(spriteKey(parseSpriteKey(k)), k);
  assert.throws(() => spriteKey({ kind: "ruler", seed: "a:b", poses: [], scale: 2, tint: 0 }), RangeError);
  assert.throws(() => spriteKey({ kind: "ruler", seed: "ab", poses: [], scale: 5, tint: 0 }), RangeError);
  assert.equal(spriteKey({ kind: "ruler", seed: "ab", poses: ["walk", "stand", "walk"], scale: 4, tint: 1 }), "ruler:ab:stand+walk:4:1");
  const missing = createSpritesHandler({ registry: {} })({ keys: ["ruler:abc:-:2:0"] });
  assert.equal(missing.sprites[0].code, "unknown_kind");
  const thrown = createSpritesHandler({ registry: { ruler: () => { throw new Error("boom at C:\\secret\\path\n    at stack"); } } })({ keys: ["ruler:abc:-:2:0"] });
  assert.equal(thrown.sprites[0].code, "render_failed");
  assert.doesNotMatch(thrown.sprites[0].message, /boom|secret|\n|\bat\b.*:\d/);
  const big = createSpritesHandler({ pngMaxBytes: 10 })({ keys: ["ruler:abc:-:2:0"] });
  assert.equal(big.sprites[0].code, "too_large");
});

test("OFFC-03 handler: every failure is a typed envelope and never throws", () => {
  const cacheThrows = createSpritesHandler({ cache: { get() { throw new Error("cache down"); }, set() {} } });
  const outputs = [cacheThrows({ keys: ["ruler:abc:-:2:0"] })];
  assert.deepEqual([outputs[0].ok, outputs[0].code], [false, "internal"]);
  const setThrows = createSpritesHandler({ cache: { get: () => undefined, set() { throw new Error("cache full"); } } });
  outputs.push(setThrows({ keys: ["ruler:abc:-:2:0"] }));
  const handle = createSpritesHandler();
  for (const input of [undefined, null, 0, "", [], {}, { keys: null }, { keys: [null] }, { keys: {} }, { keys: ["x"] }, { keys: ["ruler:abc:-:2:0"] }, { keys: Array(40).fill("x") }]) {
    assert.doesNotThrow(() => outputs.push(handle(input)));
  }
  for (const out of outputs) assert.equal(spritesRpc.output.safeParse(out).success, true, JSON.stringify(out).slice(0, 200));
});

test("OFFC-09 ruler: only the three colours, exact pixels at every zoom, pinned unscaled hash", () => {
  const spec = { kind: "ruler", seed: "abc", poses: [], scale: 2, tint: 0 };
  assert.equal(crypto.createHash("sha256").update(SPRITE_REGISTRY.ruler(spec).buf.data).digest("hex"), RULER_SHA256);
  const allowed = new Set(RULER_COLORS.map((c) => c.slice(1) + "ff"));
  for (const s of ZOOM_CANDIDATES) {
    const result = renderSpriteKey(`ruler:abc:-:${s}:0`);
    assert.equal(result.ok, true);
    const decoded = decodeUri(result.uri);
    assert.deepEqual([decoded.w, decoded.h, result.w, result.h, result.scale], [RULER_W * s, RULER_H * s, RULER_W * s, RULER_H * s, s]);
    for (let y = 0; y < decoded.h; y++) {
      for (let x = 0; x < decoded.w; x++) {
        const i = (y * decoded.w + x) * 4;
        const hex = Buffer.from(decoded.rgba.subarray(i, i + 4)).toString("hex");
        assert.ok(allowed.has(hex), `colour ${hex}`);
        const sx = Math.floor(x / s);
        const sy = Math.floor(y / s);
        assert.equal(hex, sy === 3 ? "ff0000ff" : sx % 2 === 0 ? "000000ff" : "ffffffff");
      }
    }
  }
});

test("OFFC-07 core port: headers, erasable syntax and .ts imports", () => {
  const coreDir = path.join(OFFICE, "server", "art", "core");
  const sharedDir = path.join(OFFICE, "shared");
  const core = fs.readdirSync(coreDir).filter((f) => f.endsWith(".ts"));
  assert.deepEqual(core.sort(), ["color.ts", "pixbuf.ts", "sprite.ts"]);
  const importsOf = (text) => [...text.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const file of core) {
    const text = normalise(fs.readFileSync(path.join(coreDir, file), "utf8"));
    assert.ok(text.startsWith(`// Ported from marmottajr/habblaud client/src/art/core/${file} at ${PINNED_COMMIT}`), `${file}: header`);
    assert.doesNotMatch(text, /constructor\s*\([^)]*\b(readonly|public|private|protected)\s/, `${file}: parameter property`);
    assert.doesNotMatch(text, /\benum\b|\bnamespace\b/, file);
    assert.doesNotMatch(text, /\b(document|fetch|XMLHttpRequest|HTMLCanvasElement)\b|node:/, file);
    for (const spec of importsOf(text).filter((s) => s.startsWith("."))) assert.match(spec, /\.tsx?$/, `${file}: ${spec}`);
  }
  for (const file of fs.readdirSync(sharedDir).filter((f) => f.endsWith(".ts"))) {
    const text = normalise(fs.readFileSync(path.join(sharedDir, file), "utf8"));
    for (const spec of importsOf(text)) {
      assert.doesNotMatch(spec, /^node:|^react($|-native)|server\//, `${file}: ${spec}`);
      if (spec.startsWith(".")) assert.match(spec, /\.tsx?$/, `${file}: ${spec}`);
    }
  }
  const scene = (color) => {
    const b = new PixelBuf(16, 16);
    b.rect(2, 2, 8, 8, color);
    b.stamp(["ab", "ba"], 10, 10, { a: "#ff0000", b: "#00ff00" });
    const tile = new PixelBuf(4, 4);
    tile.rect(0, 0, 4, 4, "#123456");
    b.draw(tile, 0, 12);
    b.outline();
    return b.crop(1, 1, 12, 12);
  };
  const a = scene("#336699");
  assert.deepEqual([a.w, a.h], [12, 12]);
  assert.deepEqual(a.data, scene("#336699").data);
  assert.notDeepEqual(a.data, scene("#996633").data);
  assert.equal(POSE_NAMES.length, 20);
});

// Fixture components live in a temp folder whose name contains a space and are loaded by absolute path.
function fixture(name, source) {
  const file = path.join(makeTempDir("office fixture "), name);
  fs.writeFileSync(file, source, "utf8");
  return file;
}

test("OFFC-09 host: the fake Animated surface covers what later plans call", async () => {
  const host = await fakeHost();
  let rn;
  const file = fixture(
    "probe.tsx",
    `import { Animated, Easing, Platform } from "react-native";
export function Probe(props) { props.sink({ Animated, Easing, Platform }); return null; }`,
  );
  host.mountModule(file, "Probe", { sink: (v) => (rn = v) });
  const { Animated, Easing, Platform } = rn;

  const v = new Animated.Value(3);
  assert.equal(v.current, 3);
  const seen = [];
  const id = v.addListener((e) => seen.push(e));
  v.setValue(5);
  assert.equal(v.current, 5);
  assert.deepEqual(seen, [{ value: 5 }]);
  v.removeListener(id);
  v.setValue(6);
  assert.equal(seen.length, 1);
  v.addListener((e) => seen.push(e));
  v.removeAllListeners();
  v.setValue(7);
  assert.equal(seen.length, 1);
  let stopped;
  v.stopAnimation((value) => (stopped = value));
  assert.equal(stopped, 7);
  const config = { inputRange: [0, 1], outputRange: [0, 10] };
  const mapped = v.interpolate(config);
  assert.equal(mapped.parent, v);
  assert.equal(mapped.config, config);
  for (const name of ["setOffset", "flattenOffset", "extractOffset"]) assert.equal(typeof v[name], "function", name);

  const xy = new Animated.ValueXY({ x: 1, y: 2 });
  assert.deepEqual(xy.current, { x: 1, y: 2 });
  assert.deepEqual([xy.x.current, xy.y.current], [1, 2]);
  const moves = [];
  const xyId = xy.addListener((e) => moves.push(e));
  xy.setValue({ x: 5, y: 6 });
  assert.deepEqual(moves.at(-1), { x: 5, y: 6 });
  xy.removeListener(xyId);
  const before = moves.length;
  xy.setValue({ x: 0, y: 0 });
  assert.equal(moves.length, before);

  const instant = { toValue: 1, duration: 0 };
  const slow = { toValue: 1, duration: 100 };
  let result;
  const t0 = Animated.timing(v, instant);
  t0.start((r) => (result = r));
  assert.deepEqual(result, { finished: true });
  assert.equal(v.current, 1);
  let slowCalled = false;
  const t1 = Animated.timing(v, slow);
  t1.start(() => (slowCalled = true));
  assert.equal(slowCalled, false);
  result = undefined;
  Animated.delay(0).start((r) => (result = r));
  assert.deepEqual(result, { finished: true });
  let delayed = false;
  Animated.delay(50).start(() => (delayed = true));
  assert.equal(delayed, false);

  for (const make of [Animated.sequence, Animated.parallel, (hs) => Animated.stagger(10, hs)]) {
    result = undefined;
    make([Animated.timing(v, { toValue: 2, duration: 0 }), Animated.delay(0)]).start((r) => (result = r));
    assert.deepEqual(result, { finished: true });
    let called = false;
    make([Animated.timing(v, { toValue: 2, duration: 0 }), Animated.timing(v, { toValue: 3, duration: 5 })]).start(() => (called = true));
    assert.equal(called, false);
  }
  let looped = false;
  Animated.loop(Animated.timing(v, { toValue: 4, duration: 0 })).start(() => (looped = true));
  assert.equal(looped, false);

  const entry = host.animations.find((a) => a.config === slow);
  assert.deepEqual([entry.value, entry.stopped], [v, false]);
  t1.stop();
  assert.equal(entry.stopped, true);
  t1.reset();
  assert.equal(typeof Animated.event([{ x: 1 }]), "function");
  assert.equal(Easing.linear(0.3), 0.3);
  assert.equal(typeof Easing.ease, "function");
  assert.equal(typeof Easing.bezier(0, 0, 1, 1), "function");
  assert.equal(Platform.OS, "web");
  assert.equal(Platform.select({ default: 1, web: 2 }), 2);
  assert.equal(Platform.select({ default: 1 }), 1);
  for (const name of ["View", "Text", "Image", "ScrollView"]) assert.equal(typeof Animated[name], "string", name);
  host.dispose();
});

test("OFFC-09 host: mountModule and render mount any client component", async () => {
  const host = await fakeHost();
  assert.equal(host.render, host.mountModule);
  const tracer = host.mountModule("client/tracer-screen.tsx", "TracerScreen", host.screenProps());
  await tracer.flush();
  assert.equal(tracer.find("Image").length, 1);

  const file = fixture(
    "stateful.tsx",
    `import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
const Ctx = createContext("default");
function Reader() { return <Text>{useContext(Ctx)}</Text>; }
export function Probe(props) {
  const [count, setCount] = useState(0);
  const renders = useRef(0);
  const doubled = useMemo(() => props.n * 2, [props.n]);
  const bump = useCallback(() => setCount((c) => c + 1), []);
  const value = useRef(new Animated.Value(7));
  renders.current += 1;
  props.log.push("render:" + props.n + ":" + count);
  useEffect(() => {
    props.log.push("effect");
    const id = value.current.addListener(() => props.log.push("listener"));
    props.api.bump = bump;
    props.api.value = value.current;
    return () => { props.log.push("cleanup"); value.current.removeListener(id); };
  }, []);
  return (
    <View>
      <Text>{"n=" + props.n + " count=" + count + " doubled=" + doubled + " renders=" + renders.current}</Text>
      <Ctx.Provider value="provided"><Reader /></Ctx.Provider>
      <Reader />
    </View>
  );
}`,
  );
  const log = [];
  const api = {};
  const handle = host.mountModule(file, "Probe", { n: 1, log, api });
  const texts = () => handle.find("Text").map((t) => t.children.join(""));
  assert.deepEqual(log, ["render:1:0"]);
  await handle.flush();
  assert.deepEqual(log, ["render:1:0", "effect"]);
  assert.deepEqual(texts(), ["n=1 count=0 doubled=2 renders=1", "provided", "default"]);
  api.bump();
  await handle.flush();
  assert.deepEqual(log.slice(2), ["render:1:1"]);
  handle.rerender({ n: 3, log, api });
  assert.deepEqual(texts()[0], "n=3 count=1 doubled=6 renders=3");
  api.value.setValue(1);
  assert.equal(log.filter((l) => l === "listener").length, 1);
  handle.unmount();
  handle.unmount();
  assert.equal(log.filter((l) => l === "cleanup").length, 1);
  api.value.setValue(2);
  assert.equal(log.filter((l) => l === "listener").length, 1);

  const bad = fixture("bad.tsx", `import { useTransition } from "react";\nexport function Bad() { useTransition(); return null; }`);
  assert.throws(() => host.mountModule(bad, "Bad", {}), /unsupported hook: useTransition/);
  const unmapped = fixture("unmapped.tsx", `import pad from "left-pad";\nexport function Unmapped() { return pad; }`);
  assert.throws(() => host.mountModule(unmapped, "Unmapped", {}), /unmapped import: left-pad/);
  host.dispose();
});

test("OFFC-09 host: the renderer supports the full hook set, memo and forwardRef", async () => {
  const host = await fakeHost();
  const file = fixture(
    "hooks.tsx",
    `import { forwardRef, memo, useDebugValue, useEffect, useId, useImperativeHandle, useInsertionEffect, useLayoutEffect, useReducer, useRef, useSyncExternalStore, useTransition } from "react";
import { Text, View } from "react-native";
export function Reducer(props) {
  const [n, dispatch] = useReducer((s, a) => s + a, 0);
  props.api.dispatch = dispatch;
  return <Text>{String(n)}</Text>;
}
export function Order(props) {
  useEffect(() => { props.log.push("passive"); return () => { props.log.push("passive-cleanup"); }; });
  useLayoutEffect(() => { props.log.push("layout"); return () => { props.log.push("layout-cleanup"); }; });
  useInsertionEffect(() => { props.log.push("insertion"); return () => { props.log.push("insertion-cleanup"); }; });
  useDebugValue("ignored");
  return null;
}
export function Ids(props) {
  const a = useId();
  const b = useId();
  props.ids.push([a, b]);
  return null;
}
const Inner = forwardRef(function Inner(_props, ref) {
  useImperativeHandle(ref, () => ({ hello: () => "hi" }), []);
  return null;
});
export function HandleHost(props) {
  const ref = useRef(null);
  props.refs.push(ref);
  return <Inner ref={ref} />;
}
export function Store(props) {
  const value = useSyncExternalStore(props.store.subscribe, props.store.get);
  return <Text>{String(value)}</Text>;
}
const Child = memo(function Child(props) {
  props.counter.n += 1;
  return <Text>{String(props.value)}</Text>;
});
export function MemoHost(props) {
  return <View><Child value={props.value} counter={props.counter} /><Text>{String(props.tick)}</Text></View>;
}
export function Transition() { useTransition(); return null; }`,
  );

  const api = {};
  const reducer = host.mountModule(file, "Reducer", { api });
  api.dispatch(2);
  api.dispatch(3);
  await reducer.flush();
  assert.equal(reducer.find("Text")[0].children[0], "5");

  const log = [];
  const order = host.mountModule(file, "Order", { log });
  assert.deepEqual(log, ["insertion", "layout"]);
  await order.flush();
  assert.deepEqual(log, ["insertion", "layout", "passive"]);
  order.unmount();
  assert.deepEqual(log.slice(3).sort(), ["insertion-cleanup", "layout-cleanup", "passive-cleanup"]);

  const ids = [];
  const idHandle = host.mountModule(file, "Ids", { ids });
  idHandle.rerender({ ids });
  assert.notEqual(ids[0][0], ids[0][1]);
  assert.deepEqual(ids[1], ids[0]);

  const refs = [];
  host.mountModule(file, "HandleHost", { refs });
  assert.equal(refs[0].current.hello(), "hi");

  const listeners = new Set();
  const store = { value: 1, get: () => store.value, subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)) };
  const external = host.mountModule(file, "Store", { store });
  await external.flush();
  assert.equal(external.find("Text")[0].children[0], "1");
  assert.equal(listeners.size, 1);
  store.value = 2;
  for (const cb of [...listeners]) cb();
  await external.flush();
  assert.equal(external.find("Text")[0].children[0], "2");
  external.unmount();
  assert.equal(listeners.size, 0);

  const counter = { n: 0 };
  const memoHost = host.mountModule(file, "MemoHost", { value: 1, tick: 1, counter });
  memoHost.rerender({ value: 1, tick: 2, counter });
  assert.equal(counter.n, 1);
  assert.equal(memoHost.find("Text").at(-1).children[0], "2");
  memoHost.rerender({ value: 2, tick: 2, counter });
  assert.equal(counter.n, 2);

  assert.throws(() => host.mountModule(file, "Transition", {}), /unsupported hook: useTransition/);
  host.dispose();
});

test("OFFC-09 host: the sidebar item presses through openScreen", async () => {
  const host = await fakeHost();
  const calls = [];
  const props = { ...host.screenProps(), currentScreen: null, openScreen: (input) => calls.push(input), openPopover() {} };
  const handle = host.mountModule("client/tracer-screen.tsx", "TracerSidebarItem", props);
  const rows = handle.find("SidebarRow");
  assert.equal(rows.length, 1);
  rows[0].props.onPress();
  assert.deepEqual(calls, [{ screenId: "office" }]);
  host.dispose();
});

test("OFFC-10 thresholds: the markdown block equals the JSON file", () => {
  const dir = path.join(KIT_DIR, ".planning", "phases", "07-office");
  const md = normalise(fs.readFileSync(path.join(dir, "07-SPIKE.md"), "utf8"));
  const json = JSON.parse(fs.readFileSync(path.join(dir, "07-SPIKE-THRESHOLDS.json"), "utf8"));
  const blocks = [...md.matchAll(/```json\n([\s\S]*?)\n```/g)];
  assert.equal(blocks.length, 1);
  assert.deepEqual(JSON.parse(blocks[0][1]), json);
  assert.equal(json.id, "SPIKE_THRESHOLDS_JSON");
  assert.deepEqual([json.cadence.medianMsMax, json.cadence.p95MsMax, json.cadence.windowSeconds], [125, 250, 30]);
  assert.deepEqual([json.maxDrawnCharacters, json.walkingCharacters], [32, 6]);
  assert.equal(json.firstLoadBytesMax, 2000000);
  assert.deepEqual([json.steadyState.bytesMax, json.steadyState.windowSeconds], [50000, 60]);
  assert.deepEqual(json.zoomCandidates, [...ZOOM_CANDIDATES]);
  assert.match(md, /^## SPIKE_THRESHOLDS$/m);
  assert.match(md, /^Dated: \d{4}-\d{2}-\d{2}T/m);
  assert.ok(md.includes("Desktop only; mobile not tested; one host."));
  assert.doesNotMatch(md, /^Verdict/m);
});
