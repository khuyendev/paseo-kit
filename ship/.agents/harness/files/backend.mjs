#!/usr/bin/env node
// One-shot trusted backend of the harness-files mod (D-39, D-40). stdin carries one JSON request (describe, stage,
// collect, abandon) touching only private state; target I/O runs only as `--plan|--execute <session> <ticket>` inside
// a native Bash call, so Claude Code's permission and hook chain applies (FTOL-07).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recoverCommit } from "./commit.mjs";
import { executeRequest, planRequest, targetKeys } from "./plan.mjs";
import { defaultStateRoot, identifier, locked, lockedTargets, readPrivate, sessionDirectory, sessionHash, sweep, sweepSessions, writePrivate } from "./private.mjs";
import { createStore } from "./store.mjs";
import { fileKey } from "./targets.mjs";
import { PREFIX, TOOLS, TOOL_NAMES, validateArgs } from "./tools.mjs";

export const PROTOCOL = 1;
export const MAX_INPUT = 16 * 1024 * 1024;
export const PAGE_CHARS = 40000;
export const SENTINEL = "harness-files ticket completed";
// FTOL-05: the files the mod's discovery verifies besides every .agents/harness/files/*.mjs (tests excluded):
// config.mjs and the modules it imports, and the defaults it reads. A test checks this equals the static imports.
export const TRUSTED_FIXED = Object.freeze([
  ".agents/harness/config.mjs",
  ".agents/harness/lib/config-schema.mjs",
  ".agents/harness/lib/io.mjs",
  ".agents/harness.defaults.json",
]);

const ERROR_HEAD = "ERROR (details/fix IDs are paginated, not discarded)\n";

// One page of a result: never splits a surrogate pair; the rest stays in a private page file (FTOL-13). A page file
// is never advanced or deleted on use (CR-FIL-06): a continuation whose reply was lost gives the same page again, with
// the same next token (derived from its own), until retention expires.
export function pageResult(dir, method, out, token) {
  const text = out.text;
  let end = Math.min(PAGE_CHARS, text.length);
  if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  const more = end < text.length;
  let continuation;
  if (more) {
    continuation = token ? crypto.createHash("sha256").update(`${token}\0next`).digest("hex") : crypto.randomBytes(32).toString("hex");
    writePrivate(path.join(dir, `${continuation}.page.json`), { method, text: text.slice(end), isError: !!out.isError });
  }
  const footer = more
    ? `\n\nCONTINUATION ${continuation}: call ${PREFIX}${method} with {"continuation":"${continuation}"}; the next page keeps the remaining diagnostics and fix IDs.`
    : "";
  return { method, text: `${out.isError ? ERROR_HEAD : ""}${text.slice(0, end)}${footer}`, isError: !!out.isError };
}

const file = (dir, ticket, kind) => path.join(dir, kind === "started" ? `${ticket}.started` : `${ticket}.${kind}.json`);
const UNAVAILABLE = "ticket/receipt unavailable: execution may still be running, or its private one-hour retention/budget expired; inspect target state, do not blindly repeat mutations";
const PENDING = "interrupted by a killed process; its batch is rolled back by the next file call (every call's plan step does it), then recover this receipt";
// the batch journal of the session's execution in progress: present only while a batch is being written
const JOURNAL = "journal.json";

// the reply for a ticket with no result: the rollback is still pending when its batch journal is there
function unavailable(dir, ticket) {
  const journal = path.join(dir, JOURNAL);
  return fs.existsSync(journal) && readPrivate(journal).ticket === ticket ? PENDING : UNAVAILABLE;
}

// A batch that a killed process left half-written is rolled back before any ticket runs; its ticket then gets the
// rollback as its result, so its receipt does not report an outcome that is no longer partly written. The rollback
// writes the batch's files, so it holds their target locks (FTOL-15): another session's commit of one waits for it.
function recoverInterrupted(dir, stateRoot, opts) {
  const journal = path.join(dir, JOURNAL);
  if (!fs.existsSync(journal)) return;
  const keys = readPrivate(journal).entries.map((e) => fileKey(e.abs));
  lockedTargets(stateRoot, [...new Set(keys)].sort(), () => {
    const { ticket, method, incomplete } = recoverCommit(journal);
    const text = incomplete.length
      ? `interrupted by a killed process; ROLLBACK INCOMPLETE, these files may hold the new text: ${incomplete.join("; ")}`
      : "interrupted by a killed process; rolled back: nothing written";
    writePrivate(file(dir, ticket, "result"), pageResult(dir, method, { isError: true, text }));
    fs.rmSync(file(dir, ticket, "started"), { force: true });
  }, opts);
}

function stage(dir, session, input) {
  if (typeof input.cwd !== "string" || !path.isAbsolute(input.cwd)) throw new Error("absolute session cwd required");
  const args = input.args ?? {};
  if (args.receipt) {
    const receipt = args.receipt;
    let result;
    try {
      result = readPrivate(file(dir, receipt, "result"));
    } catch (e) {
      if (e.code === "ENOENT") throw new Error(unavailable(dir, receipt));
      throw e;
    }
    if (result.method !== input.method) throw new Error("receipt belongs to a different tool");
    return { session, ticket: receipt, continuation: true };
  }
  const ticket = crypto.randomBytes(32).toString("hex");
  if (args.continuation) {
    let page;
    try {
      page = readPrivate(file(dir, args.continuation, "page"));
    } catch (e) {
      if (e.code === "ENOENT") throw new Error("continuation unknown or expired (one-hour private retention/budget); read the needed range again");
      throw e;
    }
    if (page.method !== input.method) throw new Error("continuation belongs to a different tool");
    writePrivate(file(dir, ticket, "result"), pageResult(dir, input.method, page, args.continuation));
    return { session, ticket, continuation: true };
  }
  writePrivate(file(dir, ticket, "request"), { cwd: input.cwd, method: input.method, args });
  return { session, ticket };
}

function collect(dir, input) {
  const ticket = identifier(input.ticket, "backend ticket");
  if (input.phase === "plan") {
    const plan = readPrivate(file(dir, ticket, "plan"));
    return { checks: plan.checks.map(({ tool, input: checkInput }) => ({ tool, input: checkInput })) };
  }
  let result;
  try {
    result = readPrivate(file(dir, ticket, "result"));
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(unavailable(dir, ticket));
    throw e;
  }
  for (const kind of ["request", "plan"]) fs.rmSync(file(dir, ticket, kind), { force: true });
  return { text: result.text, isError: result.isError };
}

// A staged ticket the mod gives up on: unstarted, its request is deleted under the lock so it can never execute.
function abandon(dir, input) {
  const ticket = identifier(input.ticket, "backend ticket");
  if (fs.existsSync(file(dir, ticket, "started")) || fs.existsSync(file(dir, ticket, "result"))) return { started: true };
  for (const kind of ["request", "plan"]) fs.rmSync(file(dir, ticket, kind), { force: true });
  return { started: false };
}

// opts (tests): { stateRoot, lockWaitMs }
export function transport(input, opts = {}) {
  if (!input || typeof input !== "object") throw new Error("file request must be a JSON object");
  if (input.action === "describe") return { tools: TOOLS };
  if (typeof input.session !== "string" || !input.session) throw new Error("session ID required");
  // FTOL-02: arguments are validated before any private state is written
  if (input.action === "stage") {
    if (!TOOL_NAMES.includes(input.method)) throw new Error(`unknown file tool ${input.method}`);
    validateArgs(input.method, input.args ?? {});
  } else if (!["collect", "abandon"].includes(input.action)) throw new Error("unknown transport action");
  const stateRoot = opts.stateRoot ?? defaultStateRoot();
  const session = sessionHash(input.session);
  const dir = sessionDirectory(stateRoot, session);
  return locked(dir, () => {
    sweepSessions(stateRoot, session);
    sweep(dir);
    if (input.action === "stage") return stage(dir, session, input);
    if (input.action === "collect") return collect(dir, input);
    return abandon(dir, input);
  }, opts);
}

export function runTicket(action, session, ticket, opts = {}) {
  if (action !== "--plan" && action !== "--execute") throw new Error("unknown ticket action");
  identifier(session, "backend ticket");
  identifier(ticket, "backend ticket");
  const stateRoot = opts.stateRoot ?? defaultStateRoot();
  const dir = sessionDirectory(stateRoot, session);
  return locked(dir, () => {
    recoverInterrupted(dir, stateRoot, opts);
    const stateFile = path.join(dir, "state.json");
    const store = createStore(readPrivate(stateFile, {}));
    if (action === "--execute" && fs.existsSync(file(dir, ticket, "result"))) return; // completed: never repeat
    if (action === "--execute" && fs.existsSync(file(dir, ticket, "started"))) {
      throw new Error("execution ticket already started; outcome unknown, recover receipt or inspect targets; operation will not repeat");
    }
    let request;
    try {
      request = readPrivate(file(dir, ticket, "request"));
    } catch (e) {
      if (e.code === "ENOENT") throw new Error("execution ticket unknown or withdrawn; nothing executed");
      throw e;
    }
    if (action === "--plan") return writePrivate(file(dir, ticket, "plan"), planRequest(request, store));
    const plan = readPrivate(file(dir, ticket, "plan"), null);
    if (!plan) throw new Error("execution ticket was not planned; nothing executed");
    // FTOL-15: the files a call writes are locked across sessions from read to commit (rollback included); a wait that
    // times out happens before the ticket is marked started, so nothing ran and the call can be retried
    return lockedTargets(stateRoot, targetKeys(request, plan), () => {
      fs.writeFileSync(file(dir, ticket, "started"), String(Date.now()), { flag: "wx", mode: 0o600 }); // FTOL-11
      let out;
      try {
        out = executeRequest(request, store, plan, opts.env ?? process.env, { file: path.join(dir, JOURNAL), ticket, method: request.method });
      } catch (e) {
        out = { isError: true, text: e.message };
      }
      writePrivate(stateFile, store.snapshot()); // fix IDs persist before the result is paged (FTOL-13)
      writePrivate(file(dir, ticket, "result"), pageResult(dir, request.method, out));
      fs.rmSync(file(dir, ticket, "started"), { force: true });
    }, opts);
  }, opts);
}

async function main(argv) {
  if (argv[0] === "--plan" || argv[0] === "--execute") {
    runTicket(argv[0], argv[1], argv[2]);
    process.stdout.write(`${SENTINEL}\n`);
    return;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_INPUT) throw new Error("file request exceeds 16 MiB; split the call");
    chunks.push(chunk);
  }
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    throw new Error(`file request is not JSON: ${e.message}`);
  }
  process.stdout.write(JSON.stringify({ protocol: PROTOCOL, ...transport(input) }));
}

const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
if (process.argv[1] && fold(path.resolve(process.argv[1])) === fold(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((e) => {
    process.stderr.write(`${String(e?.message ?? e).slice(0, 2000)}\n`);
    process.exitCode = 1;
  });
}
