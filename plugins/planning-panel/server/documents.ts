// Plan and file details (PANL-14, PANL-16, PANL-17): PLAN `<task>` elements in order (name, type, files), goal
// from `<objective>`, frontmatter values intact, plan completion from the SUMMARY. Tasks carry no done state:
// no GSD artifact records per-task completion.
import { promises as fs } from "node:fs";
import { planFrontmatterSchema } from "../shared/planning.ts";
import { type Yaml, parseFrontmatter } from "./frontmatter.ts";

export const DOCUMENT_MAX_BYTES = 1024 * 1024;
export const PROPERTIES_MAX = 12;
const PLAN_KEYS = new Set(["phase", "plan", "wave", "depends_on", "files_modified", "requirements", "must_haves", "type", "autonomous"]);

export async function readDocument(file: string): Promise<{ text: string; truncated: boolean }> {
  const handle = await fs.open(file, "r");
  try {
    const size = (await handle.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, DOCUMENT_MAX_BYTES));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return { text: buffer.toString("utf8", 0, bytesRead), truncated: size > DOCUMENT_MAX_BYTES };
  } finally {
    await handle.close();
  }
}

function show(v: Yaml): string {
  if (v === null) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Top-level fields shown as properties, at most PROPERTIES_MAX (PANL-14).
export function properties(data: Record<string, Yaml> | null, skip: ReadonlySet<string> = new Set()): { key: string; value: string }[] {
  return Object.entries(data ?? {})
    .filter(([k]) => !skip.has(k))
    .slice(0, PROPERTIES_MAX)
    .map(([key, value]) => ({ key, value: show(value) }));
}

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

export function planTasks(body: string): { name: string; type: string | null; files: string[] }[] {
  const tasks: { name: string; type: string | null; files: string[] }[] = [];
  for (const m of body.matchAll(/<task\b([^>]*)>([\s\S]*?)<\/task>/g)) {
    const type = /\btype\s*=\s*"([^"]*)"/.exec(m[1])?.[1] ?? null;
    const name = /<name>([\s\S]*?)<\/name>/.exec(m[2])?.[1];
    const files = /<files>([\s\S]*?)<\/files>/.exec(m[2])?.[1];
    const fallback = /<(decision|what-built)>([\s\S]*?)<\/\1>/.exec(m[2])?.[2];
    tasks.push({
      name: decode(name ?? fallback ?? `Task ${tasks.length + 1}`),
      type,
      files: files ? decode(files).split(/[,\n]/).map((s) => s.trim()).filter(Boolean) : [],
    });
  }
  return tasks;
}

export function planGoal(body: string): string | null {
  const objective = /<objective>([\s\S]*?)<\/objective>/.exec(body)?.[1];
  const text = objective ? decode(objective).split(/\n\s*\n/)[0] : null;
  return text ? text.replace(/\s+/g, " ").trim() : null;
}

export function parsePlan(text: string) {
  const fm = parseFrontmatter(text);
  if ("error" in fm) return fm;
  const data = fm.data ?? {};
  const parsed = planFrontmatterSchema.safeParse(data);
  if (!parsed.success) return { error: `invalid plan frontmatter: ${parsed.error.issues[0]?.path.join(".")}`, line: 1 };
  const plan = parsed.data;
  return {
    goal: planGoal(fm.body),
    wave: plan.wave,
    dependsOn: plan.depends_on,
    filesModified: plan.files_modified,
    requirements: plan.requirements,
    mustHaves: plan.must_haves,
    tasks: planTasks(fm.body),
    properties: properties(data, PLAN_KEYS),
  };
}

const list = (v: Yaml | undefined): string[] => (Array.isArray(v) ? v.filter((x) => x !== null).map(String) : typeof v === "string" && v ? [v] : []);

export function parseSummary(text: string) {
  const fm = parseFrontmatter(text);
  if ("error" in fm) return fm;
  const data = fm.data ?? {};
  const kf = data["key-files"];
  const keyFiles = kf && typeof kf === "object" && !Array.isArray(kf) ? kf : {};
  return {
    status: data.status === null || data.status === undefined ? null : String(data.status),
    text: fm.body.trim(),
    keyFiles: { created: list(keyFiles.created), modified: list(keyFiles.modified) },
  };
}
