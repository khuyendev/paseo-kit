// Outbound size check (PCLI-05, INV-11) and the thinking clamp (PCLI-10).
import { THINKING_LEVELS } from "../lib/config-schema.mjs";

export const promptBytes = (text) => Buffer.byteLength(String(text), "utf8");

// A 42 MB prompt made the daemon drop the runner socket (wf_20261004-153848_8eb7): measure before any daemon call.
export function assertPromptSize(text, cfg) {
  const bytes = promptBytes(text);
  if (bytes > cfg.max_prompt_bytes) {
    throw new Error(`prompt is ${bytes} bytes > max_prompt_bytes ${cfg.max_prompt_bytes}; pass a file path instead of inlining content`);
  }
}

// Exact level if supported, else the nearest supported level (ties high); never `off` unless asked for exactly.
export function clampThinking(requested, supported) {
  if (requested === undefined || requested === null || !supported?.length) return undefined;
  if (supported.includes(requested)) return requested;
  const want = THINKING_LEVELS.indexOf(requested);
  if (want < 0) return undefined;
  let best;
  let bestDistance = Infinity;
  for (const level of supported) {
    const at = THINKING_LEVELS.indexOf(level);
    if (at < 0 || level === "off") continue;
    const distance = Math.abs(at - want);
    if (distance < bestDistance || (distance === bestDistance && at > THINKING_LEVELS.indexOf(best))) {
      best = level;
      bestDistance = distance;
    }
  }
  return best;
}
