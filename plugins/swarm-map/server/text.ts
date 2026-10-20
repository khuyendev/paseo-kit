// Small text helpers shared by the server modules.

export function clip(text: string, maxChars: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t;
}

export function firstLine(text: string): string {
  return text.split(/\r?\n/).find((l) => l.trim() !== "")?.trim() ?? "";
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

export function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return firstLine(message) || "unknown error";
}

export function id8(id: string): string {
  return id.slice(0, 8);
}

// "A.md" for one file, "N files: A.md, B.md, ..." for several (PANL-34, PANL-39).
export function filesLabel(paths: readonly string[], shown: number): string {
  if (paths.length === 1) return baseName(paths[0]);
  const names = paths.slice(0, shown).map(baseName).join(", ");
  return `${paths.length} files: ${names}${paths.length > shown ? ", ..." : ""}`;
}
