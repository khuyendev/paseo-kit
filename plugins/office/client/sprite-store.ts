// Sprite cache over the office.sprites call (OFFC-08, D-01): every key is asked at most once while the store lives, calls are chunked and
// bounded, one stable source object per key, and every failure becomes a typed entry. Pure: no React, no timer, no Node API.
import { parseSpriteKey, SPRITE_KEYS_PER_CALL_MAX, spritesRpc, type SpriteFrame } from "../shared/sprites-rpc.ts";
import { SPRITE_CALLS_IN_FLIGHT_MAX, SPRITE_STORE_KEYS_MAX } from "./limits.ts";

const PNG_PREFIX = "data:image/png;base64,";

export type SpriteEntry =
  | { state: "pending" }
  | { state: "ready"; source: { uri: string }; w: number; h: number; scale: number; frame: SpriteFrame | null }
  | { state: "failed"; code: string; message: string };

export type SpritesCall = (input: { keys: string[] }) => Promise<unknown>;

export interface SpriteStore {
  get(key: string): SpriteEntry | null;
  request(keys: readonly string[]): void;
  // Asks the call_failed keys among the given ones (all when omitted) once more; other failures are final.
  retry(keys?: readonly string[]): void;
  getVersion(): number;
  subscribe(listener: () => void): () => void;
  // Resolves when nothing is queued or in flight.
  settle(): Promise<void>;
  dispose(): void;
}

function failed(code: string, message: string): SpriteEntry {
  return { state: "failed", code, message };
}

export function createSpriteStore(call: SpritesCall): SpriteStore {
  const entries = new Map<string, SpriteEntry>();
  // Keys refused because the store is full; bounded too, and never requested.
  const refused = new Map<string, SpriteEntry>();
  const queue: string[] = [];
  const listeners = new Set<() => void>();
  let waiters: Array<() => void> = [];
  let inFlight = 0;
  let pumpScheduled = false;
  let notifyScheduled = false;
  let version = 0;
  let disposed = false;

  function idle(): boolean {
    return queue.length === 0 && inFlight === 0 && !pumpScheduled;
  }

  function wake(): void {
    if (!idle()) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  }

  function changed(): void {
    version++;
    if (notifyScheduled || disposed) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      if (disposed) return;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // a throwing listener must not stop the others
        }
      }
    });
  }

  function failKeys(keys: readonly string[], code: string, message: string): void {
    for (const key of keys) entries.set(key, failed(code, message));
  }

  function apply(chunk: readonly string[], response: unknown): void {
    const parsed = spritesRpc.output.safeParse(response);
    if (!parsed.success) return failKeys(chunk, "bad_response", "bad response");
    const out = parsed.data;
    if (!out.ok) return failKeys(chunk, "call_failed", out.code);
    if (out.sprites.length !== chunk.length) return failKeys(chunk, "mismatch", "result count");
    if (out.sprites.some((sprite, i) => sprite.key !== chunk[i])) return failKeys(chunk, "mismatch", "key order");
    if (out.sprites.some((sprite) => sprite.ok && !sprite.uri.startsWith(PNG_PREFIX))) return failKeys(chunk, "bad_response", "bad uri");
    out.sprites.forEach((sprite, i) => {
      const key = chunk[i] as string;
      if (sprite.ok) {
        // The source object is created once, when the entry turns ready, so every get returns the same reference.
        entries.set(key, { state: "ready", source: { uri: sprite.uri }, w: sprite.w, h: sprite.h, scale: sprite.scale, frame: sprite.frame });
      } else {
        entries.set(key, failed(sprite.code, sprite.code));
      }
    });
  }

  async function run(chunk: string[]): Promise<void> {
    inFlight++;
    let response: unknown = { ok: false };
    let threw = false;
    try {
      response = await call({ keys: chunk });
    } catch {
      threw = true;
    }
    inFlight--;
    if (disposed) return wake();
    if (threw) failKeys(chunk, "call_failed", "call failed");
    else apply(chunk, response);
    changed();
    pump();
    wake();
  }

  function pump(): void {
    while (!disposed && inFlight < SPRITE_CALLS_IN_FLIGHT_MAX && queue.length > 0) {
      void run(queue.splice(0, SPRITE_KEYS_PER_CALL_MAX));
    }
  }

  function schedulePump(): void {
    if (pumpScheduled || disposed) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      pump();
      wake();
    });
  }

  function request(keys: readonly string[]): void {
    if (disposed || !Array.isArray(keys)) return;
    let failedNow = false;
    for (const key of keys) {
      if (typeof key !== "string" || entries.has(key) || refused.has(key)) continue;
      if (entries.size >= SPRITE_STORE_KEYS_MAX) {
        if (refused.size < SPRITE_STORE_KEYS_MAX) refused.set(key, failed("store_full", "store full"));
        failedNow = true;
        continue;
      }
      if (parseSpriteKey(key) === null) {
        entries.set(key, failed("bad_key", "bad key"));
        failedNow = true;
        continue;
      }
      entries.set(key, { state: "pending" });
      queue.push(key);
    }
    if (failedNow) changed();
    if (queue.length > 0) schedulePump();
  }

  function retry(keys?: readonly string[]): void {
    if (disposed) return;
    const wantedKeys = keys ?? [...entries.keys()];
    let any = false;
    for (const key of wantedKeys) {
      const entry = entries.get(key);
      if (entry && entry.state === "failed" && entry.code === "call_failed") {
        entries.set(key, { state: "pending" });
        queue.push(key);
        any = true;
      }
    }
    if (any) {
      changed();
      schedulePump();
    }
  }

  return {
    get: (key) => entries.get(key) ?? refused.get(key) ?? null,
    request,
    retry,
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settle: () => (idle() ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve))),
    dispose() {
      disposed = true;
      listeners.clear();
      queue.length = 0;
      wake();
    },
  };
}
