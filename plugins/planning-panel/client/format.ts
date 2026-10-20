// Date and time formatting (PANL-23). Date-only strings ("2026-10-20") are local dates.
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const RELATIVE_DAYS = 14;

function parseDate(value: string | number): Date | null {
  if (typeof value === "number") return new Date(value);
  const d = DATE_ONLY.exec(value);
  const date = d ? new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | number | null): string | null {
  if (value === null) return null;
  const date = parseDate(value);
  return date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : String(value);
}

export function formatShortDate(value: string | number | null): string | null {
  if (value === null) return null;
  const date = parseDate(value);
  return date ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : String(value);
}

export function formatRelative(value: string | number | null, nowMs: number): string | null {
  if (value === null) return null;
  const date = parseDate(value);
  if (!date) return String(value);
  const elapsed = nowMs - date.getTime();
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < RELATIVE_DAYS * DAY_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return formatDate(value);
}

export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function clip(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

// AND-tokens over a haystack, case-insensitive, any order (PANL-17, PANL-20).
export function matchesTokens(haystack: string, query: string): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  const h = haystack.toLowerCase();
  return tokens.every((t) => h.includes(t));
}
