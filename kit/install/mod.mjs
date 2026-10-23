// harness-files mod activation through Claude Code's own CLI, only with --enable-plugin (INST-20, INST-21, INST-23).
import fs from "node:fs";
import path from "node:path";
import { readJsonIf } from "../../ship/.agents/harness/lib/io.mjs";
import { fileDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { samePath, toSlash } from "../../ship/.agents/harness/lib/paths.mjs";
import { errText } from "../../ship/.agents/harness/lib/cli.mjs";
import { batchWriterProblem, batchWriterServers, filePluginState, MOD_OFF_HOOK_CONSEQUENCE, modSelected } from "../../ship/.agents/harness/paseo-client/plugins.mjs";
import { claudeVersion, FILE_PLUGIN_ID, MIN_CLAUDE_VERSION, NODE_REQUIREMENT, nodeRuntimeProblem, runClaude, versionAtLeast } from "../../ship/.agents/harness/platform.mjs";
import { fail } from "./failure.mjs";
import { SETTINGS_REL } from "./hooks.mjs";

export const PLUGINS_REL = ".claude/plugins";
const [PLUGIN_NAME, MARKETPLACE] = FILE_PLUGIN_ID.split("@");
// Every mod asset must be present; the backend discovery script is one of them (FTOL-05).
const ASSETS = [
  `${PLUGINS_REL}/.claude-plugin/marketplace.json`,
  ...[".claude-plugin/plugin.json", "hooks/hooks.json", "hooks/register.ts", "scripts/discover.mjs"].map((rel) => `${PLUGINS_REL}/${PLUGIN_NAME}/${rel}`),
];

// Node and Claude Code gates, run before any write and never skipped by --force (INST-22).
export function checkModGates(env) {
  const nodeProblem = nodeRuntimeProblem();
  if (nodeProblem) fail(`the file mod needs ${NODE_REQUIREMENT}: ${nodeProblem}`);
  const version = claudeVersion(env);
  if (versionAtLeast(version, MIN_CLAUDE_VERSION) !== true) {
    fail(`file mod requires Claude Code >= ${MIN_CLAUDE_VERSION}; found ${version ?? "no working claude CLI"}`);
  }
}

// Relative forward-slash path -> digest of every file below `dir`.
function treeDigests(dir) {
  const out = new Map();
  const walk = (abs, rel) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
      else if (entry.isFile()) out.set(childRel, fileDigest(path.join(abs, entry.name)));
    }
  };
  if (fs.existsSync(dir)) walk(dir, "");
  return out;
}

const sameTree = (a, b) => a.size === b.size && [...a].every(([rel, digest]) => b.get(rel) === digest);

function registeredMarketplaces(ctx) {
  const r = runClaude(["plugin", "marketplace", "list", "--json"], { cwd: ctx.project, encoding: "utf8", timeout: 60000 }, ctx.env);
  if (r.error || r.status !== 0) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed?.marketplaces) ? parsed.marketplaces : [];
  } catch {
    return [];
  }
}

// A marketplace name is registered once per Claude config: reuse another project's identical copy, stop on a different one.
function installArgs(ctx, marketplaceDir) {
  const own = ["plugin", "install", PLUGIN_NAME, "--marketplace", marketplaceDir, "--scope", "project"];
  const entry = registeredMarketplaces(ctx).find((m) => m?.name === MARKETPLACE);
  const folder = entry?.path ?? entry?.installLocation;
  if (typeof folder !== "string" || samePath(folder, marketplaceDir)) return own;
  if (!sameTree(treeDigests(folder), treeDigests(marketplaceDir))) {
    fail(`marketplace ${MARKETPLACE} is already registered from ${folder} with different plugin files; update that project to this kit version, or run: claude plugin marketplace remove ${MARKETPLACE}`);
  }
  ctx.out(`harness-files mod: reusing the marketplace already registered from ${folder} (identical plugin files)`);
  return ["plugin", "install", FILE_PLUGIN_ID, "--scope", "project"];
}

// Kit feedback 84: the doctor line for an unselected mod, what that costs the hooks, and any batch writer still registered.
function warnModOff(ctx) {
  const state = filePluginState(ctx.project, ctx.env);
  if (modSelected(state)) return;
  ctx.out(`harness-files mod: not selected (ph doctor: note file mod not selected, enabledPlugins has no ${FILE_PLUGIN_ID}); ${MOD_OFF_HOOK_CONSEQUENCE}`);
  const { servers } = batchWriterServers(ctx.project, ctx.env);
  for (const server of servers) ctx.out(`problem ${batchWriterProblem(server)}`);
}

function note(ctx) {
  const settings = readJsonIf(path.join(ctx.project, SETTINGS_REL), {});
  if (settings?.enabledPlugins?.[FILE_PLUGIN_ID] === true) {
    ctx.out("harness-files mod: project settings already enable it (not changed or verified here; ph doctor reports readiness)");
  } else {
    ctx.out(`harness-files mod: copied, not enabled; to enable: node "${ctx.kitScript}" update "${toSlash(ctx.project)}" --enable-plugin (Claude Code >= ${MIN_CLAUDE_VERSION})`);
  }
  warnModOff(ctx);
  return 0;
}

// Wiring step. The kit never edits enabledPlugins itself; Claude Code's CLI does under the caller's CLAUDE_CONFIG_DIR.
export function activateMod(ctx) {
  if (!ctx.enablePlugin) return note(ctx);
  const pluginsDir = path.join(ctx.project, PLUGINS_REL);
  const untracked = ASSETS.some((rel) => !fs.existsSync(path.join(ctx.project, rel)))
    || [...treeDigests(pluginsDir)].some(([rel, digest]) => ctx.records[`${PLUGINS_REL}/${rel}`] !== digest);
  if (untracked) throw new Error("file mod has untracked or locally modified assets; resolve conflicts before enabling");
  const args = installArgs(ctx, pluginsDir);
  const r = runClaude(args, { cwd: ctx.project, encoding: "utf8", timeout: 300000 }, ctx.env);
  if (r.error || r.status !== 0) {
    throw new Error(`plugin install failed (${r.status ?? r.error?.code}): ${errText(r.stderr || r.stdout || r.error?.message || "")}`);
  }
  ctx.out("harness-files mod: installed for this project by claude plugin install (scope project); current-session activation is not verified: start a new Claude session");
  return 0;
}
