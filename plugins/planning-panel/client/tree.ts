// File tree of `.planning/` (PANL-17): single-child folder chains merged ("a/b"), natural sort, folder counts,
// top-level folders expanded by default; local AND-token filter over path and title.
import type { IndexFile } from "../shared/planning.ts";
import { matchesTokens } from "./format.ts";

export type TreeRow =
  | { kind: "folder"; key: string; path: string; name: string; depth: number; count: number; expanded: boolean }
  | { kind: "file"; key: string; path: string; name: string; depth: number };

interface Node {
  name: string;
  path: string;
  folders: Map<string, Node>;
  files: string[];
  count: number;
}

export type Expansion = ReadonlySet<string> | "all";

const natural = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function build(paths: readonly string[]): Node {
  const root: Node = { name: "", path: "", folders: new Map(), files: [], count: 0 };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (const seg of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${seg}` : seg;
      let next = node.folders.get(seg);
      if (!next) {
        next = { name: seg, path, folders: new Map(), files: [], count: 0 };
        node.folders.set(seg, next);
      }
      node = next;
    }
    node.files.push(p);
  }
  const count = (n: Node): number => (n.count = n.files.length + [...n.folders.values()].reduce((s, f) => s + count(f), 0));
  count(root);
  return root;
}

function emit(node: Node, depth: number, expansion: Expansion, rows: TreeRow[]): void {
  for (const folder of [...node.folders.values()].sort((a, b) => natural(a.name, b.name))) {
    let current = folder;
    let label = folder.name;
    while (current.files.length === 0 && current.folders.size === 1) {
      current = current.folders.values().next().value!;
      label = `${label}/${current.name}`;
    }
    const expanded = expansion === "all" || expansion.has(current.path);
    rows.push({ kind: "folder", key: `d:${current.path}`, path: current.path, name: label, depth, count: current.count, expanded });
    if (expanded) emit(current, depth + 1, expansion, rows);
  }
  for (const p of [...node.files].sort((a, b) => natural(a.split("/").pop()!, b.split("/").pop()!))) {
    rows.push({ kind: "file", key: `f:${p}`, path: p, name: p.split("/").pop()!, depth });
  }
}

export function buildTree(paths: readonly string[], expansion: Expansion = new Set()): TreeRow[] {
  const rows: TreeRow[] = [];
  emit(build(paths), 0, expansion, rows);
  return rows;
}

export function topLevelFolders(paths: readonly string[]): string[] {
  return buildTree(paths).flatMap((r) => (r.kind === "folder" ? [r.path] : []));
}

export function allFolders(paths: readonly string[]): string[] {
  return buildTree(paths, "all").flatMap((r) => (r.kind === "folder" ? [r.path] : []));
}

// Every ancestor folder of a file, so opening it can reveal it in the tree.
export function ancestors(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export function filterFiles(files: readonly IndexFile[], query: string): IndexFile[] {
  return files.filter((f) => matchesTokens(`${f.path} ${f.title}`, query));
}
