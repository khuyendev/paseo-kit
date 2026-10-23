#!/usr/bin/env node
// Manual smoke check of the Paseo SDK surface the two plugins, planning-panel and office, use (PANL-10, OFFC-23). Run it
// against a live daemon after installing or upgrading Paseo:  node plugins/smoke.mjs [--app-dir "<Paseo install dir>"]
// It is read-only: it lists agents and workspaces, reads one timeline tail, refreshes one agent and one workspace and
// checks that the office subscription surfaces exist without calling them; it never sends, spawns, archives or writes.
// Not part of the offline test suite.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { daemonTarget, findCliDir } from "../ship/.agents/harness/paseo-client/locate.mjs";
import { iconNames } from "./smoke-icons.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGENT_FIELDS = ["id", "provider", "model", "status", "title", "labels", "cwd", "workspaceId", "createdAt", "updatedAt", "thinkingOptionId", "currentModeId", "pendingPermissions", "requiresAttention", "attentionReason", "activeTurn", "lastUsage", "archivedAt"];
const WORKSPACE_FIELDS = ["id", "projectId", "projectDisplayName", "projectRootPath", "workspaceKind", "name"];
const TIMELINE_TYPES = ["tool_call", "user_message", "assistant_message", "reasoning", "compaction", "todo", "error"];
const DETAIL_TYPES = ["read", "edit", "write", "shell", "search", "fetch", "sub_agent", "worktree_setup", "plan", "plain_text", "unknown"];
const LIFECYCLE = ["agent.created", "agent.archived", "agent.turn_started", "agent.turn_ended", "agent.permission_requested", "agent.permission_resolved"];

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok    " : "FAILED"} ${what}`);
  if (!ok) failures += 1;
};
const hasFields = (obj, fields, what) => {
  const missing = fields.filter((f) => !(f in (obj ?? {})));
  check(missing.length === 0, `${what}${missing.length ? `: missing ${missing.join(", ")}` : ""}`);
};

const kebab = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])(\d)/g, "$1-$2").toLowerCase();

function checkIcons(appDir) {
  const dist = path.join(appDir, "resources", "app-dist");
  if (!fs.existsSync(dist)) return check(false, `icons: no Paseo app bundle at ${dist} (pass --app-dir)`);
  let bundle = "";
  for (const f of fs.readdirSync(dist, { recursive: true })) if (String(f).endsWith(".js")) bundle += fs.readFileSync(path.join(dist, String(f)), "utf8");
  for (const icon of iconNames(HERE)) check(bundle.includes(`"${kebab(icon)}"`), `icon ${icon} (${kebab(icon)})`);
}

async function main() {
  const argAt = process.argv.indexOf("--app-dir");
  const appDir = argAt > 0 ? process.argv[argAt + 1] : path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Paseo");
  const cliDir = findCliDir(process.env);
  const { connectToDaemon } = await import(pathToFileURL(path.join(cliDir, "dist", "utils", "client.js")).href);
  const { createPaseoApi } = await import(pathToFileURL(path.join(cliDir, "node_modules", "@getpaseo", "client", "dist", "index.js")).href);
  const daemon = await connectToDaemon({ target: daemonTarget(process.env) });
  try {
    const paseo = createPaseoApi(daemon);
    const list = await paseo.agents.list({ filter: { includeArchived: false, statuses: ["initializing", "idle", "running", "error"] }, sort: [{ key: "created_at", direction: "asc" }], page: { limit: 5 } });
    check(Array.isArray(list.entries) && "pageInfo" in list, "agents.list returns entries and pageInfo");
    const agent = list.entries[0]?.agent;
    if (agent) {
      hasFields(agent, AGENT_FIELDS, "agent fields");
      const page = await paseo.agents.ref(agent.id).timeline.refetch({ direction: "tail", limit: 8, projection: "projected" });
      check(Array.isArray(page.entries), "agents.ref().timeline.refetch returns entries");
      for (const e of page.entries) {
        hasFields(e, ["item", "timestamp", "seqStart"], `timeline entry ${e.item?.type}`);
        if (e.item?.type === "tool_call") check(DETAIL_TYPES.includes(e.item.detail?.type), `tool detail type ${e.item.detail?.type} is mapped`);
        else check([...TIMELINE_TYPES, "notification", "plugin"].includes(e.item?.type), `timeline item type ${e.item?.type} is known`);
      }
      const refreshed = await paseo.agents.ref(agent.id).refresh();
      check(refreshed?.agent?.id === agent.id, "agents.ref().refresh returns the agent");
      check(typeof paseo.agents.ref(agent.id).timeline.subscribe === "function", "office SDK: agents.ref().timeline.subscribe is a function");
    } else check(false, "no live agent to read (start one with ph spawn and rerun)");
    for (const [name, fn] of [["agents.subscribe", paseo.agents.subscribe], ["workspaces.subscribe", paseo.workspaces.subscribe], ["projects.subscribe", paseo.projects.subscribe], ["observeEvents", paseo.observeEvents]]) {
      check(typeof fn === "function", `office SDK: ${name} is a function`);
    }
    const ws = await paseo.workspaces.list();
    check(Array.isArray(ws.entries), "workspaces.list returns entries");
    const first = ws.entries[0];
    if (first) {
      hasFields(first, WORKSPACE_FIELDS, "workspace fields");
      const ref = paseo.workspaces.ref(first.id);
      const cur = ref.current() ?? (await ref.refresh());
      check(typeof (cur?.workspaceDirectory ?? ref.directory) === "string", "workspaces.ref().current/refresh/directory give a directory");
    }
    const lifecycle = fs.readFileSync(path.join(HERE, "office", "node_modules", "@getpaseo", "plugin", "dist", "server", "lifecycle.d.ts"), "utf8");
    for (const name of LIFECYCLE) check(lifecycle.includes(`"${name}"`), `lifecycle event ${name}`);
    checkIcons(appDir);
  } finally {
    await daemon.close?.();
  }
  console.log(failures === 0 ? "smoke passed" : `smoke failed: ${failures} checks`);
  process.exit(failures === 0 ? 0 : 2);
}

main().catch((err) => {
  console.error(`failed: ${err?.message ?? err}`);
  process.exit(1);
});
