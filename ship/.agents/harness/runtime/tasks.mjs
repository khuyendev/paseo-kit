// ph task: the ephemeral shared task list of a team in its workspace dir, never planning state (PHCL-35, D-18).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { UsageError } from "../lib/cli.mjs";
import { readJsonIf, writeTextIfChanged } from "../lib/io.mjs";

export const STATUSES = Object.freeze(["pending", "in_progress", "completed", "blocked"]);
const LOCK_WAIT_MS = 10000;
const LOCK_STEP_MS = 100;
const LOCK_STALE_MS = 30000;

// Removes the lock only while it still holds `token`. It is renamed aside first, so the check and the removal act on the
// same file; a lock a live owner put in its place meanwhile is linked back, as files/private.mjs recoverLock does.
function removeLockIf(lock, token) {
  const aside = `${lock}.${crypto.randomBytes(8).toString("hex")}.stale`;
  try {
    fs.renameSync(lock, aside);
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  if (fs.readFileSync(aside, "utf8") === token) {
    fs.rmSync(aside, { force: true });
    return;
  }
  try {
    fs.linkSync(aside, lock);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  fs.rmSync(aside, { force: true });
}

async function withLock(file, clock, fn) {
  const lock = `${file}.lock`;
  const token = crypto.randomBytes(8).toString("hex");
  for (let waited = 0; ; waited += LOCK_STEP_MS) {
    try {
      fs.writeFileSync(lock, token, { flag: "wx" });
      break;
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      // an empty lock is one still being written or cut short: it is judged by its age alone
      let owner;
      let age = 0;
      try {
        owner = fs.readFileSync(lock, "utf8");
        age = Date.now() - fs.statSync(lock).mtimeMs;
      } catch {
        continue;
      }
      if (age > LOCK_STALE_MS) {
        removeLockIf(lock, owner);
        continue;
      }
      if (waited >= LOCK_WAIT_MS) throw new Error(`task list locked: ${lock}`);
      await clock.sleep(LOCK_STEP_MS);
    }
  }
  try {
    return await fn();
  } finally {
    removeLockIf(lock, token);
  }
}

function parseIds(text) {
  if (text === undefined) return undefined;
  if (!text.trim()) return [];
  return text.split(",").map((t) => {
    if (!/^\s*\d+\s*$/.test(t)) throw new UsageError(`invalid dependency '${t.trim()}'`);
    return Number(t);
  });
}

function checkStatus(status) {
  if (status !== undefined && !STATUSES.includes(status)) throw new UsageError(`--status must be one of ${STATUSES.join("|")}`);
}

// Self, unknown and cyclic dependencies are refused; a cycle is a path from a dependency back to the task.
function checkDependencies(tasks, id, deps) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  for (const dep of deps) {
    if (dep === id) throw new Error(`invalid dependency ${id} -> ${dep}: a task cannot depend on itself`);
    if (!byId.has(dep)) throw new Error(`invalid dependency ${id} -> ${dep}: no task ${dep}`);
  }
  const reaches = (from, seen = new Set()) => {
    if (from === id) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    return (byId.get(from)?.depends_on ?? []).some((d) => reaches(d, seen));
  };
  const cyclic = deps.find((dep) => reaches(dep));
  if (cyclic !== undefined) throw new Error(`invalid dependency ${id} -> ${cyclic}: creates a cycle`);
}

export function readyTasks(tasks) {
  const done = new Set(tasks.filter((t) => t.status === "completed").map((t) => t.id));
  return tasks.filter((t) => t.status === "pending" && t.depends_on.every((d) => done.has(d)));
}

function taskId(text) {
  if (!/^\d+$/.test(text ?? "")) throw new UsageError("name the task id");
  return Number(text);
}

async function task(ctx) {
  const { opts, args } = ctx;
  const [sub, idText] = args;
  if (!["add", "update", "list", "get"].includes(sub)) throw new UsageError("task add | update | list | get");
  if (!opts.ws) throw new UsageError("--ws is required");
  checkStatus(opts.status);
  const dir = path.resolve(ctx.root, opts.ws);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "tasks.json");
  const now = () => new Date(ctx.clock.now()).toISOString();
  return withLock(file, ctx.clock, () => {
    const data = readJsonIf(file, { tasks: [] });
    const tasks = data.tasks ?? [];
    const save = () => writeTextIfChanged(file, `${JSON.stringify({ ...data, tasks }, null, 2)}\n`);
    if (sub === "add") {
      if (!opts.title) throw new UsageError("--title is required");
      const id = tasks.reduce((max, t) => Math.max(max, t.id), 0) + 1;
      const deps = parseIds(opts["depends-on"]) ?? [];
      const unknown = deps.filter((d) => !tasks.some((t) => t.id === d));
      if (unknown.length) throw new Error(`unknown dependency ${unknown.join(", ")}`);
      tasks.push({ id, title: opts.title, assignee: opts.assignee ?? null, depends_on: deps, status: opts.status ?? "pending", notes: opts.notes ?? "", updated: now() });
      save();
      ctx.out(`task ${id} added`);
      return 0;
    }
    if (sub === "list") {
      const ready = new Set(readyTasks(tasks).map((t) => t.id));
      const shown = tasks.filter((t) => (opts.assignee === undefined || t.assignee === opts.assignee) && (opts.status === undefined || t.status === opts.status));
      for (const t of shown) {
        ctx.out(`${t.id} ${t.status} ${t.assignee ?? "-"} ${t.title}${t.depends_on.length ? ` after ${t.depends_on.join(",")}` : ""}${ready.has(t.id) ? " READY" : ""}`);
      }
      return 0;
    }
    const id = taskId(idText);
    const t = tasks.find((x) => x.id === id);
    if (!t) throw new Error(`no task ${id}`);
    if (sub === "get") {
      ctx.out(JSON.stringify(t, null, 2));
      return 0;
    }
    const deps = parseIds(opts["depends-on"]);
    if (deps !== undefined) checkDependencies(tasks, id, deps);
    Object.assign(t, {
      ...(opts.title !== undefined ? { title: opts.title } : {}),
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(opts.assignee !== undefined ? { assignee: opts.assignee } : {}),
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
      ...(deps !== undefined ? { depends_on: deps } : {}),
      updated: now(),
    });
    save();
    ctx.out(`task ${id} ${t.status}`);
    return 0;
  });
}

export const taskCommands = [
  {
    name: "task",
    summary: "shared team task list in <ws>/tasks.json: add, update, list (READY marks), get",
    usage: "ph task add --ws D --title T [--assignee A] [--depends-on 1,2] [--notes N] [--status S] | update ID --ws D [...] | list --ws D [--assignee A] [--status S] | get ID --ws D",
    options: { ws: "string", title: "string", assignee: "string", "depends-on": "string", notes: "string", status: "string" },
    config: "none",
    run: task,
  },
];
