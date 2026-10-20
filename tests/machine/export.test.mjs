import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadKitConfig } from "../../ship/.agents/harness/config.mjs";
import { KIT_DIR } from "../helpers/temp.mjs";
import { isPlaceholder, SECRET_KEY, templateErrors } from "../../kit/machine/template.mjs";
import { completeMachine, ENDPOINT, makeMachine, SECRETS, SHIPPED_TEMPLATE, TOKEN } from "./helpers.mjs";

const readTemplate = (m) => JSON.parse(fs.readFileSync(path.join(m.kitDir, "paseo", "providers.json"), "utf8"));
const templateText = (m) => fs.readFileSync(path.join(m.kitDir, "paseo", "providers.json"), "utf8");

async function liveWith(edit) {
  const m = await completeMachine();
  const live = m.readConfig();
  edit(live.agents.providers, live);
  fs.writeFileSync(m.config, JSON.stringify(live), "utf8");
  return m;
}

test("MACH-13 export scrubs the token, the endpoint and its host, also in a description", async () => {
  const m = await liveWith((p) => {
    p.circle.description = `Claude Code through ${ENDPOINT} (host proxy.example.test)`;
    p.circle.label = `Circle at proxy.example.test`;
  });
  const before = m.configBytes();
  const r = await m.run(["export"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  assert.match(r.out[0], /^wrote .*providers\.json: providers circle, circle-agent \(secrets as \{\{secret:NAME\}\}, home folder as \{\{HOME\}\}\)$/);
  const text = templateText(m);
  for (const secret of [TOKEN, ENDPOINT, "proxy.example.test"]) assert.equal(text.includes(secret), false, secret);
  const tpl = JSON.parse(text);
  assert.equal(tpl.providers.circle.env.ANTHROPIC_AUTH_TOKEN, "{{secret:ANTHROPIC_AUTH_TOKEN}}");
  assert.equal(tpl.providers.circle.env.ANTHROPIC_BASE_URL, "{{secret:ANTHROPIC_BASE_URL}}");
  assert.equal(tpl.providers.circle.env.CLAUDE_CONFIG_DIR, "{{HOME}}/.claude-circle");
  assert.match(tpl.providers.circle.description, /\{\{secret:ANTHROPIC_BASE_URL\}\}/);
  assert.deepEqual(m.configBytes(), before);
  assert.deepEqual(templateErrors(tpl, loadKitConfig()), []);
});

test("MACH-13 short and overlapping secrets: placeholders in secret fields, other strings and names intact", async () => {
  const m = await liveWith((p) => {
    p.circle.env.ANTHROPIC_AUTH_TOKEN = "a";
    p.circle.env.OTHER_KEY = "abcdefgh";
    p["circle-agent"].env.ANTHROPIC_AUTH_TOKEN = "abcdefgh-2";
    p.circle.description = "a plain label with abcdefgh-2 and abcdefghx";
  });
  const r = await m.run(["export"]);
  assert.equal(r.code, 0, r.err.join("\n"));
  const tpl = readTemplate(m);
  assert.equal(tpl.providers.circle.env.ANTHROPIC_AUTH_TOKEN, "{{secret:ANTHROPIC_AUTH_TOKEN}}");
  assert.equal(tpl.providers.circle.env.OTHER_KEY, "{{secret:OTHER_KEY}}");
  assert.equal(tpl.providers.circle.description, "a plain label with {{secret:ANTHROPIC_AUTH_TOKEN}} and abcdefghx");
  assert.equal(tpl.providers.circle.label, readTemplate(makeMachine()).providers.circle.label);
  assert.ok(Object.keys(tpl.providers.circle.env).includes("ANTHROPIC_DEFAULT_OPUS_MODEL"));
});

test("MACH-13 canonical policy: worker without disallowedTools and kit env keys; main = live denies + main list", async () => {
  const m = await liveWith((p) => {
    p.circle.disallowedTools = ["OwnerDeny", "Agent"];
    p["circle-agent"].disallowedTools.push("Bash(rm *)");
  });
  assert.equal((await m.run(["export"])).code, 0);
  const tpl = readTemplate(m);
  assert.equal("disallowedTools" in tpl.providers["circle-agent"], false);
  assert.equal("ENABLE_TOOL_SEARCH" in tpl.providers["circle-agent"].env, false);
  assert.deepEqual(tpl.providers.circle.disallowedTools, ["OwnerDeny", "Agent", "Workflow"]);
  assert.deepEqual(tpl.metadataGeneration, m.readConfig().agents.metadataGeneration);
  assert.match(tpl._notes, /\{\{secret:NAME\}\}/);
  assert.match(tpl._notes, /paseo reload/);
});

test("MACH-13 a forced leak exits 1 and leaves the old template unchanged", async () => {
  const m = await liveWith((p, live) => (live.agents.metadataGeneration = { providers: [{ provider: "circle", model: TOKEN }] }));
  const old = templateText(m);
  const r = await m.run(["export"]);
  assert.equal(r.code, 1);
  assert.equal(r.err[0], "failed: a secret would be written into the template; not written");
  assert.equal(templateText(m), old);
});

test("MACH-13 a provider of agent_providers missing from the live config fails", async () => {
  const m = await liveWith((p) => delete p["circle-agent"]);
  const r = await m.run(["export"]);
  assert.equal(r.code, 1);
  assert.match(r.err[0], /^failed: provider circle-agent \(kit agent_providers\) is not in /);
});

test("MACH-13 round trip: export -> apply on an empty config -> check exits 0, with a main extra deny", async () => {
  const m = await liveWith((p) => p.circle.disallowedTools.push("OwnerOnMain"));
  assert.equal((await m.run(["export"])).code, 0);
  const fresh = makeMachine({ template: readTemplate(m) });
  const r = await fresh.run(["apply", "--no-reload"], SECRETS);
  assert.equal(r.code, 0, r.stdout);
  assert.ok(fresh.readConfig().agents.providers.circle.disallowedTools.includes("OwnerOnMain"));
  assert.equal((await fresh.run(["check"])).code, 0);
});

test("MACH-14 the shipped template passes the template schema check", () => {
  const tpl = JSON.parse(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"));
  assert.deepEqual(templateErrors(tpl, loadKitConfig()), []);
  assert.deepEqual(Object.keys(tpl.providers), ["circle", "circle-agent"]);
  for (const p of Object.values(tpl.providers)) {
    assert.equal(p.extends, "claude");
    assert.equal(p.env.CLAUDE_CONFIG_DIR, "{{HOME}}/.claude-circle");
    assert.equal(p.env.ANTHROPIC_BASE_URL, "{{secret:ANTHROPIC_BASE_URL}}");
    assert.equal(p.env.ANTHROPIC_AUTH_TOKEN, "{{secret:ANTHROPIC_AUTH_TOKEN}}");
  }
  assert.deepEqual(tpl.providers.circle.disallowedTools, ["Agent", "Workflow"]);
  assert.equal("disallowedTools" in tpl.providers["circle-agent"], false);
  assert.equal("ENABLE_TOOL_SEARCH" in tpl.providers["circle-agent"].env, false);
});

test("MACH-14 the template check rejects a worker policy, a raw secret, a missing main deny and a home path", () => {
  const cfg = loadKitConfig();
  const tpl = JSON.parse(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"));
  tpl.providers["circle-agent"].disallowedTools = ["Agent"];
  tpl.providers.circle.env.ANTHROPIC_AUTH_TOKEN = "raw";
  tpl.providers.circle.disallowedTools = ["Agent"];
  tpl.providers.circle.env.CLAUDE_CONFIG_DIR = "C:/Users/someone/.claude-circle";
  const errors = templateErrors(tpl, cfg).join("\n");
  assert.match(errors, /circle-agent\.disallowedTools: a worker stores no policy/);
  assert.match(errors, /circle\.env\.ANTHROPIC_AUTH_TOKEN: a secret field must be a/);
  assert.match(errors, /circle\.disallowedTools: lacks Workflow/);
  assert.match(errors, /circle\.env\.CLAUDE_CONFIG_DIR: absolute path/);
});

function jsonFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", "node_modules", ".planning"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsonFiles(full, out);
    else if (entry.name.endsWith(".json")) out.push(full);
  }
  return out;
}

test("MACH-14 no kit JSON file holds a secret-keyed env value that is not a placeholder", () => {
  const offenders = [];
  const visit = (value, file) => {
    if (Array.isArray(value)) value.forEach((v) => visit(v, file));
    else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) {
        if (k === "env" && v && typeof v === "object") {
          for (const [ek, ev] of Object.entries(v)) if (SECRET_KEY.test(ek) && typeof ev === "string" && ev && !isPlaceholder(ev)) offenders.push(`${file}: ${ek}`);
        }
        visit(v, file);
      }
    }
  };
  for (const file of jsonFiles(KIT_DIR)) {
    try {
      visit(JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")), file);
    } catch {
      // not JSON data (JSONC or a fixture): nothing to scan
    }
  }
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(fs.readFileSync(SHIPPED_TEMPLATE, "utf8"), /[A-Za-z]:[\\/]{1,2}Users|\/home\//);
});
