// Bug-hunt fix G207: the role catalog of docs/INTERFACES.md section 4.2 lists every GSD role, the workflows that call it,
// the agent type it starts and the tier it runs on, and it cannot drift from GSD_ROLES, the workflow sources or the agents.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { KIT_DIR, SHIP_DIR } from "../helpers/temp.mjs";
import { GSD_ROLES, loadKitConfig } from "../../ship/.agents/harness/config.mjs";

const WORKFLOWS = path.join(SHIP_DIR, ".agents", "workflows");
const AGENTS = path.join(SHIP_DIR, ".agents", "agents");
const INTERFACES = path.join(KIT_DIR, "docs", "INTERFACES.md");
const ROLE_LITERAL = /(?:\brole: |\bro\(|\broleOpts\(|\bagentFor\()"([a-z_]+)"/g;

const agentNames = new Set(fs.readdirSync(AGENTS).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)));
const backticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const modelOf = (agent) => fs.readFileSync(path.join(AGENTS, `${agent}.md`), "utf8").match(/^model: (\S+)$/m)?.[1];

// The "#### Role catalog" table under section 4.2: one {role, agents, tier} per data row.
function catalog() {
  const lines = fs.readFileSync(INTERFACES, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith("#### Role catalog"));
  assert.notEqual(start, -1, "docs/INTERFACES.md has no '#### Role catalog' table under section 4.2");
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("|")) {
      if (rows.length) break;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells[0] === "role" || cells[0].startsWith("---")) continue;
    rows.push({ role: backticked(cells[0])[0], agents: backticked(cells[2]), tier: backticked(cells[3])[0] });
  }
  return rows;
}

// Role literals each workflow passes, with the agent type names written on the same line.
function workflowRoles() {
  const used = new Map();
  for (const file of fs.readdirSync(WORKFLOWS).filter((f) => f.endsWith(".js"))) {
    for (const line of fs.readFileSync(path.join(WORKFLOWS, file), "utf8").split(/\r?\n/)) {
      const roles = [...line.matchAll(ROLE_LITERAL)].map((m) => m[1]);
      const names = [...line.matchAll(/"([\w.-]+)"/g)].map((m) => m[1]).filter((n) => agentNames.has(n));
      for (const role of roles) used.set(role, new Set([...(used.get(role) ?? []), ...names]));
    }
  }
  return used;
}

test("G207 the role catalog lists every GSD role exactly once and no other", () => {
  const listed = catalog().map((row) => row.role);
  assert.deepEqual([...listed].sort(), [...GSD_ROLES].sort());
});

test("G207 every role the workflows pass is in the catalog with the agent types its calls start", () => {
  const rows = new Map(catalog().map((row) => [row.role, row]));
  for (const [role, names] of workflowRoles()) {
    assert.ok(rows.has(role), `workflows pass role ${role}; the catalog does not list it`);
    for (const name of names) {
      assert.ok(rows.get(role).agents.includes(name), `role ${role} starts ${name} in the workflows; the catalog lists ${rows.get(role).agents.join(", ") || "no agent"}`);
    }
  }
});

test("G207 every catalog agent type exists, and each tier is the agent's model or the kit default tier when it starts none", () => {
  const defaultTier = loadKitConfig().default_tier;
  for (const row of catalog()) {
    for (const agent of row.agents) assert.ok(agentNames.has(agent), `role ${row.role} lists agent ${agent}; no .agents/agents/${agent}.md`);
    const expected = row.agents.length ? modelOf(row.agents[0]) : defaultTier;
    assert.equal(row.tier, expected, `role ${row.role} lists tier ${row.tier}; it runs on ${expected}`);
  }
});

test("G207 the gsd-plan and ph skills link to the role catalog", () => {
  for (const skill of ["gsd-plan", "ph"]) {
    const text = fs.readFileSync(path.join(SHIP_DIR, ".claude", "skills", skill, "SKILL.md"), "utf8");
    assert.match(text, /docs\/INTERFACES\.md[^\n]*Role catalog|Role catalog[^\n]*docs\/INTERFACES\.md/, `${skill} skill does not link to the role catalog`);
  }
});
