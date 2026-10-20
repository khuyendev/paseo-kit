// In-process driver of the file backend: stage, plan, execute and collect as the mod does, against a temp state root.
import fs from "node:fs";
import path from "node:path";
import { makeTempDir } from "../helpers/temp.mjs";
import { runTicket, transport } from "../../ship/.agents/harness/files/backend.mjs";

export function scratch(files = {}) {
  const root = makeTempDir("paseo kit files ");
  const write = (rel, data) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), data);
  };
  for (const [rel, data] of Object.entries(files)) write(rel, data);
  return {
    root,
    path: (rel) => path.join(root, rel),
    write,
    read: (rel) => fs.readFileSync(path.join(root, rel), "utf8"),
    bytes: (rel) => fs.readFileSync(path.join(root, rel)),
    exists: (rel) => fs.existsSync(path.join(root, rel)),
  };
}

// A backend client for one session: `call(method, args)` runs the full ticket flow and returns
// { text, isError, checks, ticket } (checks: the plan's permission checks).
export function client({ cwd, session = "session-a", stateRoot = makeTempDir("paseo kit state "), env = {} } = {}) {
  const opts = { stateRoot, env };
  const t = (input) => transport(input, opts);
  const c = {
    stateRoot,
    opts,
    t,
    stage: (method, args) => t({ action: "stage", session, cwd, method, args }),
    plan: (stage) => {
      runTicket("--plan", stage.session, stage.ticket, opts);
      return t({ action: "collect", phase: "plan", session, ticket: stage.ticket }).checks;
    },
    execute: (stage) => runTicket("--execute", stage.session, stage.ticket, opts),
    collect: (ticket) => t({ action: "collect", session, ticket }),
    abandon: (ticket) => t({ action: "abandon", session, ticket }),
    call(method, args) {
      const stage = c.stage(method, args);
      let checks = [];
      if (!stage.continuation) {
        checks = c.plan(stage);
        c.execute(stage);
      }
      return { ...c.collect(stage.ticket), checks, ticket: stage.ticket, session: stage.session };
    },
  };
  return c;
}

// the tag of the first read_ranges entry header in a reply
export const tagOf = (text) => /, tag (\S+?)(?:\s|$|\()/.exec(text)?.[1];
// the fix IDs of a reply, in order
export const fixIds = (text) => [...text.matchAll(/^([a-z]{2}\d+) /gm)].map((m) => m[1]);
