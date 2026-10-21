// Key to sprite: renderer lookup, PNG encoding, byte-bounded LRU and the never-throwing office.sprites handler (OFFC-03, OFFC-08).
import {
  SPRITE_KEYS_PER_CALL_MAX,
  SPRITE_KEY_MAX_CHARS,
  parseSpriteKey,
  spriteKey,
  type SpriteKind,
  type SpriteResult,
  type SpritesOutput,
} from "../shared/sprites-rpc.ts";
import { SPRITE_CACHE_MAX_BYTES, SPRITE_PNG_MAX_BYTES } from "./limits.ts";
import { encodePng, pngDataUri } from "./png.ts";
import { SPRITE_REGISTRY, type SpriteRenderer } from "./sprite-registry.ts";

// Least-recently-used map bounded by a byte total; Map insertion order is the recency order.
export class ByteLru<V> {
  readonly capBytes: number;
  #entries = new Map<string, { value: V; bytes: number }>();
  #total = 0;

  constructor(capBytes: number) {
    this.capBytes = capBytes;
  }

  get size(): number {
    return this.#entries.size;
  }

  get bytes(): number {
    return this.#total;
  }

  get(key: string): V | undefined {
    const hit = this.#entries.get(key);
    if (!hit) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, bytes: number): void {
    this.delete(key);
    if (bytes > this.capBytes) return;
    this.#entries.set(key, { value, bytes });
    this.#total += bytes;
    for (const [oldest, entry] of this.#entries) {
      if (this.#total <= this.capBytes) break;
      this.#entries.delete(oldest);
      this.#total -= entry.bytes;
    }
  }

  delete(key: string): boolean {
    const hit = this.#entries.get(key);
    if (!hit) return false;
    this.#entries.delete(key);
    this.#total -= hit.bytes;
    return true;
  }

  clear(): void {
    this.#entries.clear();
    this.#total = 0;
  }
}

export type SpriteCache = Pick<ByteLru<SpriteResult>, "get" | "set">;

export interface SpriteDeps {
  registry: Readonly<Partial<Record<SpriteKind, SpriteRenderer>>>;
  cache: SpriteCache;
  pngMaxBytes: number;
}

function defaultDeps(): SpriteDeps {
  return { registry: SPRITE_REGISTRY, cache: new ByteLru<SpriteResult>(SPRITE_CACHE_MAX_BYTES), pngMaxBytes: SPRITE_PNG_MAX_BYTES };
}

const sharedDeps = defaultDeps();

function fail(key: string, code: Extract<SpriteResult, { ok: false }>["code"], message: string): SpriteResult {
  return { ok: false, key: key.slice(0, SPRITE_KEY_MAX_CHARS), code, message };
}

// Never throws for a bad key or a failing renderer; a throwing cache dependency propagates to the handler.
export function renderSpriteKey(key: string, overrides: Partial<SpriteDeps> = {}): SpriteResult {
  const deps: SpriteDeps = { ...sharedDeps, ...overrides };
  const spec = parseSpriteKey(key);
  if (!spec) return fail(key, "bad_key", "The sprite key is not valid.");
  const canonical = spriteKey(spec);
  const hit = deps.cache.get(canonical);
  if (hit) return hit;
  const renderer = deps.registry[spec.kind];
  if (!renderer) return fail(canonical, "unknown_kind", "No renderer for this sprite kind.");
  let rendered: ReturnType<SpriteRenderer>;
  try {
    rendered = renderer(spec);
  } catch {
    return fail(canonical, "render_failed", "The sprite could not be drawn.");
  }
  let png: Buffer;
  try {
    png = encodePng(rendered.buf.data, rendered.buf.w, rendered.buf.h, spec.scale);
  } catch (error) {
    if (error instanceof RangeError) return fail(canonical, "too_large", "The sprite is over the size cap.");
    return fail(canonical, "render_failed", "The sprite could not be encoded.");
  }
  if (png.length > deps.pngMaxBytes) return fail(canonical, "too_large", "The encoded sprite is over the byte cap.");
  const uri = pngDataUri(png);
  const frame = rendered.frame
    ? { w: rendered.frame.w * spec.scale, h: rendered.frame.h * spec.scale, cols: rendered.frame.cols, rows: rendered.frame.rows }
    : null;
  const result: SpriteResult = { ok: true, key: canonical, w: rendered.buf.w * spec.scale, h: rendered.buf.h * spec.scale, scale: spec.scale, frame, uri };
  deps.cache.set(canonical, result, uri.length);
  return result;
}

// The handler takes unknown input and never throws: every failure is a typed envelope.
export function createSpritesHandler(overrides: Partial<SpriteDeps> = {}): (input: unknown) => SpritesOutput {
  const deps: SpriteDeps = { ...defaultDeps(), ...overrides };
  return (input) => {
    try {
      const keys = (input as { keys?: unknown } | null | undefined)?.keys;
      if (typeof input !== "object" || input === null || !Array.isArray(keys) || keys.some((k) => typeof k !== "string")) {
        return { ok: false, code: "bad_input", message: "Expected an object with a keys array of strings." };
      }
      if (keys.length > SPRITE_KEYS_PER_CALL_MAX) return { ok: false, code: "too_many_keys", message: "Too many keys in one call." };
      const seen = new Map<string, SpriteResult>();
      const sprites = (keys as string[]).map((key) => {
        let result = seen.get(key);
        if (!result) {
          result = renderSpriteKey(key, deps);
          seen.set(key, result);
        }
        return result;
      });
      return { ok: true, sprites };
    } catch {
      return { ok: false, code: "internal", message: "The sprite request failed." };
    }
  };
}
