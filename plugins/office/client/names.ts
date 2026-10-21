// No upstream: written for the agent states of the office.
// A generated name per agent (a first name from the fixed list of the strings table and an initial, both from a hash of the id) and a
// provider chip (the first letter of the provider id and a colour of a fixed palette). Pure: no randomness, no React, no SDK.
import { LABEL_MAX_CHARS } from "./limits-panels.ts";
import { AGENT_FIRST_NAMES, AGENT_INITIALS, clipText, text } from "./strings.ts";

// Chip colours; a provider keeps its colour because the index comes from a hash of its id.
export const CHIP_COLORS: readonly string[] = ["#e07a5f", "#3d85c6", "#81b29a", "#c9a227", "#9b5de5", "#f15bb5", "#00a6a6", "#8d6e63"];

// FNV-1a with the murmur3 finalizer, so ids that differ in one character still spread over the whole list.
function fnv1a(value: string, offset: number): number {
  let hash = offset >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

export function agentName(agentId: unknown): string {
  const id = String(agentId);
  const first = AGENT_FIRST_NAMES[fnv1a(id, 0x811c9dc5) % AGENT_FIRST_NAMES.length] as string;
  const initial = AGENT_INITIALS.charAt(fnv1a(id, 0x01000193) % AGENT_INITIALS.length);
  return text("agentNameFormat", { first, initial });
}

export interface ProviderChip {
  letter: string;
  color: string;
}

// Null when the provider id has no letter or digit.
export function providerChip(provider: unknown): ProviderChip | null {
  const shown = clipText(provider, LABEL_MAX_CHARS);
  const match = /[A-Za-z0-9]/.exec(shown);
  if (match === null) return null;
  return { letter: match[0].toUpperCase(), color: CHIP_COLORS[fnv1a(shown.toLowerCase(), 0x811c9dc5) % CHIP_COLORS.length] as string };
}
