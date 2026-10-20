// File paths named by a tool input: `paths[]`, `files[].path`, `ranges[].path` (PANL-34), distinct non-blank
// strings in order. Independent of the tool's name.
export function batchFilePaths(input: Record<string, unknown>, keys: readonly string[] = ["files", "ranges"]): string[] {
  const paths: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === "string" && value.trim() && !paths.includes(value)) paths.push(value);
  };
  if (Array.isArray(input.paths)) input.paths.forEach(add);
  for (const key of keys) {
    const entries = input[key];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object") add((entry as Record<string, unknown>).path);
    }
  }
  return paths;
}
