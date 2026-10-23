// Permission plan and execution of one request (FTOL-08, FTOL-09): every target the handler may touch is listed
// with its canonical path for the mod's tool.check, and --execute recomputes the plan and runs only against it.
import fs from "node:fs";
import path from "node:path";
import { discoverConfigRoot, loadConfig } from "../config.mjs";
import { editMultiple, writeMultiple } from "./edit.mjs";
import { guessPath } from "./guess.mjs";
import { readRanges } from "./reader.mjs";
import { absolutePath, canonicalPath, pathKey } from "./targets.mjs";
import { validateArgs } from "./tools.mjs";

function checksFor({ cwd, method, args }, store) {
  const checks = new Map();
  const add = (abs, tool, input = {}) => {
    const real = canonicalPath(abs);
    for (const file of new Set([abs, real])) {
      checks.set(`${tool}\0${pathKey(file)}\0${JSON.stringify(input)}`, { tool, input: { file_path: file, ...input }, abs, real });
    }
  };
  // staged siblings and renames modify the parent folder too, also for existing files; new folders are created
  const parents = (abs) => {
    let parent = path.dirname(abs);
    while (!fs.existsSync(parent) && path.dirname(parent) !== parent) {
      add(parent, "Write", { content: "" });
      parent = path.dirname(parent);
    }
    add(parent, "Write", { content: "" });
  };
  const editTarget = (value, edits) => {
    const abs = absolutePath(value, cwd);
    add(abs, "Read");
    for (const e of edits.length ? edits : [{}]) add(abs, "Edit", { old_string: e.oldText ?? "", new_string: e.newText ?? "" });
    parents(abs);
  };
  if (method === "read_ranges") {
    for (const r of args.ranges) {
      const abs = absolutePath(r.path, cwd);
      add(abs, "Read");
      if (!fs.existsSync(abs)) {
        const g = guessPath(abs, cwd);
        if (g.unique) add(g.unique, "Read");
      }
    }
  } else if (method === "write_multiple_files") {
    for (const f of args.files) {
      const abs = absolutePath(f.path, cwd);
      add(abs, "Read");
      add(abs, "Write", { content: f.content });
      parents(abs);
    }
  } else {
    for (const f of args.files ?? []) editTarget(f.path, f.edits);
    for (const fx of args.fixes ?? []) {
      const e = store.fix(String(fx.id));
      if (!e) continue;
      const target = fx.path ?? e.abs ?? e.path;
      if (!target) continue;
      if (e.edits) editTarget(target, e.edits);
      else {
        const oldText = fx.oldText ?? (fx.occurrence === undefined ? e.cand : undefined) ?? e.oldText ?? "";
        editTarget(target, [{ oldText, newText: fx.newText ?? e.newText ?? e.line?.newText ?? "" }]);
      }
    }
  }
  return [...checks.values()];
}

const signature = (checks) => JSON.stringify(checks.map((c) => [c.tool, c.input, c.abs, c.real]).map((x) => JSON.stringify(x)).sort());

export function planRequest(request, store) {
  if (!path.isAbsolute(request.cwd)) throw new Error("backend cwd must be absolute");
  validateArgs(request.method, request.args);
  const checks = checksFor(request, store);
  return { checks, signature: signature(checks) };
}

const HANDLERS = { read_ranges: readRanges, edit_multiple_files: editMultiple, write_multiple_files: writeMultiple };

// Returns { text, isError? }; the store is updated in place. journal: { file, ticket, method } for the batch journal.
export function executeRequest(request, store, plan, env = process.env, journal = null) {
  const current = planRequest(request, store);
  if (current.signature !== plan.signature) throw new Error("permission plan changed (paths, symlinks or retained fixes); nothing executed, retry the call");
  const expected = new Map(plan.checks.map((c) => [pathKey(path.resolve(c.abs)), c.real]));
  const guard = (abs) => {
    const want = expected.get(pathKey(path.resolve(abs)));
    if (want === undefined || canonicalPath(abs) !== want) throw new Error(`unplanned or changed target: ${abs}; nothing authorized for this path`);
  };
  // FTOL-17: the project's read_limits per request; an invalid overlay fails this call only
  const limits = loadConfig(discoverConfigRoot(request.cwd, env)).read_limits;
  const out = HANDLERS[request.method](request.args, { cwd: request.cwd, limits, guard, store, journal });
  return typeof out === "string" ? { text: out } : out;
}
