// Text formatting for the swarm map (PANL-23): relative times, durations, token counts, short labels.

export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// Elapsed time as m:ss, or h:mm:ss after an hour.
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

export function tokens(n: number | null): string {
  if (n === null) return "?";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// "circle/gpt-6.1-sol[1m]" -> "gpt-6.1-sol [1m]"
export function shortModel(model: string): string {
  return model.replace(/^[^/]+\//, "").replace(/\[(\w+)\]$/, " [$1]");
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function clip(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
}

// Replaces every path in a text with its last segment.
export function withBaseNames(text: string): string {
  return text.replace(/(?:[A-Za-z]:)?[\\/]?(?:[^\s\\/:"'|]+[\\/])+([^\s\\/"'|]*)/g, (_m, last: string) => last || "…");
}

// Node label: the title without its swarm prefix (the `ph.swarm` label) and with paths shortened; a leading
// counter ("#3", "07") becomes a badge.
export function shortTitle(title: string, swarm: string | null): { badge: string | null; label: string } {
  let rest = title.trim();
  if (swarm && rest.toLowerCase().startsWith(swarm.toLowerCase()) && rest.length > swarm.length) rest = rest.slice(swarm.length).replace(/^[\s:·-]+/, "");
  const num = /^#?(\d+)\s*[:\-]?\s*/.exec(rest);
  if (num) rest = rest.slice(num[0].length);
  const label = withBaseNames(rest).replace(/\s+/g, " ").trim();
  return { badge: num ? num[1] : null, label: label || title };
}
