import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  ConfigError, DEFAULTS_FILE, KIT_OWNED_KEYS, MACHINE_KEYS, configProvenance, configRoot, discoverConfigRoot,
  loadConfig, loadConfigLenient, loadKitConfig, mergeOverlay, validateConfig,
} from "../../ship/.agents/harness/config.mjs";
import { SCHEMA, TOP_LEVEL_KEYS } from "../../ship/.agents/harness/lib/config-schema.mjs";
import { makeTempDir, makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const project = (overlay, extra = {}) => makeTempProject({ git: false, overlay, ...extra });
const failsWith = (fn, message) => assert.throws(fn, (e) => {
  assert.ok(e instanceof ConfigError, `not a ConfigError: ${e}`);
  assert.equal(e.message, message);
  return true;
});
const withOverlay = (overlay) => () => loadConfig(project(overlay).root);

function shipFiles(dir = SHIP_DIR, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) shipFiles(abs, out);
    else if (/\.(mjs|js|ts|tsx|json|md)$/.test(entry.name)) out.push(abs);
  }
  return out;
}

test("CONF-01 overlay with _notes and no overlay load the defaults", () => {
  const defaults = loadKitConfig();
  assert.deepEqual(loadConfig(project({ _notes: "x" }).root), defaults);
  assert.deepEqual(loadConfig(project(undefined).root), defaults);
});

test("CONF-01 an overlay that is not an object fails with the message", () => {
  failsWith(withOverlay([]), "invalid harness config overlay: expected an object");
});

test("CONF-01 PASEO_HARNESS_ROOT picks the root; loads are independent and never mutate the defaults", () => {
  const a = project({ max_subagents: 5, max_live_subagents: 6 });
  const b = project({ max_subagents: 7, max_live_subagents: 8 });
  assert.equal(configRoot({ PASEO_HARNESS_ROOT: a.root }, b.root), path.resolve(a.root));
  assert.equal(configRoot({}, b.root), path.resolve(b.root));
  const before = fs.readFileSync(DEFAULTS_FILE, "utf8");
  const ca = loadConfig(configRoot({ PASEO_HARNESS_ROOT: a.root }));
  const cb = loadConfig(b.root);
  ca.tiers.pro.provider = "mutated/x";
  assert.equal(ca.max_subagents, 5);
  assert.equal(cb.max_subagents, 7);
  assert.equal(loadKitConfig().tiers.pro.provider, "");
  assert.equal(fs.readFileSync(DEFAULTS_FILE, "utf8"), before);
});

test("CONF-02 BOM-prefixed overlay and manifest load", () => {
  const p = project(undefined);
  p.write(".agents/harness.config.json", "﻿{\"max_subagents\": 3}");
  p.write(".agents/harness-kit.json", "﻿{\"version\": \"0.0.1\", \"installedAt\": \"a\", \"updatedAt\": \"b\", \"files\": {}}");
  assert.equal(loadConfig(p.root).max_subagents, 3);
  assert.deepEqual(configProvenance(p.root).manifest, { version: "0.0.1", installedAt: "a", updatedAt: "b" });
});

test("CONF-02 __proto__, constructor and prototype keys fail at any depth", () => {
  const p = project(undefined);
  p.write(".agents/harness.config.json", '{"tiers": {"__proto__": {}}}');
  assert.throws(() => loadConfig(p.root), { message: "invalid harness key __proto__" });
  assert.throws(() => mergeOverlay(loadKitConfig(), { gsd: { roles: { constructor: {} } } }), { message: "invalid harness key constructor" });
  assert.throws(() => mergeOverlay(loadKitConfig(), { adapter: { review_lenses: [{ prototype: 1 }] } }), { message: "invalid harness key prototype" });
});

test("CONF-02 lint: no shipped module parses a whole file outside readJson", () => {
  const offenders = shipFiles()
    .filter((f) => /\.(mjs|js|ts)$/.test(f) && !f.endsWith(path.join("lib", "io.mjs")))
    .filter((f) => /JSON\.parse\(\s*(fs\.)?readFileSync\(/.test(fs.readFileSync(f, "utf8")));
  assert.deepEqual(offenders, []);
});

test("CONF-03 machine keys cannot be set by a project", () => {
  const cfg = loadConfig(project({
    main_provider_disallowed_tools: [],
    agent_providers: { x: "y" },
    agent_provider_disallowed_tools: [],
    agent_provider_env: { A: "b" },
  }).root);
  assert.deepEqual(cfg.main_provider_disallowed_tools, ["Agent", "Workflow"]);
  assert.deepEqual(cfg.agent_providers, { circle: "circle-agent" });
  assert.ok(cfg.agent_provider_disallowed_tools.includes("SendMessage"));
  assert.deepEqual(cfg.agent_provider_env, { ENABLE_TOOL_SEARCH: "true" });
  assert.deepEqual(MACHINE_KEYS, ["agent_providers", "agent_provider_disallowed_tools", "agent_provider_env", "main_provider_disallowed_tools"]);
});

test("CONF-04 merged keys merge per entry, others replace", () => {
  const defaults = loadKitConfig();
  const cfg = loadConfig(project({
    io_guard: { step_rounds: 3 },
    allowed_models: ["circle/x"],
    tiers: { pro: { provider: "circle/p", thinking: "high" } },
    adapter: { review_lenses: [{ name: "security", text: "look for injection" }] },
  }).root);
  assert.deepEqual(cfg.io_guard, { ...defaults.io_guard, step_rounds: 3 });
  assert.deepEqual(cfg.allowed_models, ["circle/x"]);
  assert.deepEqual(cfg.tiers.pro, { provider: "circle/p", thinking: "high" });
  assert.deepEqual(cfg.tiers.frontier, defaults.tiers.frontier);
  assert.deepEqual(cfg.tiers.standard, defaults.tiers.standard);
  assert.equal(cfg.adapter.review_lenses.length, 1);
  assert.deepEqual(cfg.adapter.commands, defaults.adapter.commands);
  assert.deepEqual(cfg.gsd, defaults.gsd);
});

test("CONF-05 closed validation: unknown, missing and mistyped keys", () => {
  failsWith(withOverlay({ bogus: 1 }), "invalid harness config bogus: unknown key");
  failsWith(withOverlay({ io_guard: { foo: 1 } }), "invalid harness config io_guard.foo: unknown key");
  failsWith(withOverlay({ max_subagents: "20" }), "invalid harness config max_subagents: expected integer");
  failsWith(withOverlay({ warmup: "yes" }), "invalid harness config warmup: expected boolean");
  const dir = makeTempDir();
  const raw = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
  delete raw.runs_keep;
  const file = path.join(dir, "harness.defaults.json");
  fs.writeFileSync(file, JSON.stringify(raw));
  failsWith(() => loadKitConfig({ defaultsFile: file }), "invalid harness config runs_keep: missing key");
  failsWith(() => loadConfig(project(undefined).root, { defaultsFile: file }), "invalid harness config runs_keep: missing key");
});

test("CONF-05 the schema module holds no default value", () => {
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    assert.ok(!Object.hasOwn(node, "default") && !Object.hasOwn(node, "value"), "schema node carries a value");
    for (const child of Object.values(node)) if (typeof child === "object") walk(child);
  };
  walk(SCHEMA);
  const source = fs.readFileSync(path.join(SHIP_DIR, ".agents", "harness", "lib", "config-schema.mjs"), "utf8");
  for (const shipped of ["262144", "bypassPermissions", "circle-agent", "Compaction done", "36000", "fidelity"]) {
    assert.ok(!source.includes(shipped), `schema contains the shipped value ${shipped}`);
  }
});

test("CONF-06 typed rules, one failing overlay per rule", () => {
  const cases = [
    [{ max_subagents: 0 }, "max_subagents: must be >= 1"],
    [{ max_live_subagents: 0 }, "max_live_subagents: must be >= 1"],
    [{ max_agents_per_workflow: 0 }, "max_agents_per_workflow: must be >= 1"],
    [{ wait_timeout_s: 0 }, "wait_timeout_s: must be >= 1"],
    [{ max_prompt_bytes: 0 }, "max_prompt_bytes: must be >= 1"],
    [{ schema_retries: -1 }, "schema_retries: must be >= 0"],
    [{ runs_keep: 1.5 }, "runs_keep: expected integer"],
    [{ tiers: { pro: { provider: "nomodel" } } }, 'tiers.pro.provider: expected "" or provider/model'],
    [{ tiers: { pro: { provider: "a/b", extra: 1 } } }, "tiers.pro.extra: unknown key"],
    [{ tiers: { pro: { provider: "a/b", thinking: "huge" } } }, "tiers.pro.thinking: expected one of off|low|medium|high|xhigh|max"],
    [{ tiers: { pro: { provider: "a/b", features: [] } } }, "tiers.pro.features: expected object"],
    [{ default_tier: "nosuch" }, "default_tier: must name a tier, an alias or a provider/model"],
    [{ tier_aliases: { fast: "nosuch" } }, "tier_aliases.fast: must name a tier or a provider/model"],
    [{ tier_aliases: { fast: 1 } }, "tier_aliases.fast: expected string"],
    [{ prime_role: "one-turn" }, "prime_role: expected one of two-turn|off"],
    [{ platform_notes: { win32: 1 } }, "platform_notes.win32: expected string"],
    [{ context_guard: { start_pct: 0 } }, "context_guard.start_pct: must be between 1 and 100"],
    [{ context_guard: { step_pct: 101 } }, "context_guard.step_pct: must be between 1 and 100"],
    [{ context_guard: { window_tokens: 0 } }, "context_guard.window_tokens: must be >= 1"],
    [{ io_guard: { step_rounds: 0 } }, "io_guard.step_rounds: must be >= 1"],
    [{ io_guard: { edit_step_rounds: 0 } }, "io_guard.edit_step_rounds: must be >= 1"],
    [{ io_guard: { start_rounds: -1 } }, "io_guard.start_rounds: must be >= 0"],
    [{ read_limits: { fileMaxChars: 200000, replyMaxChars: 450000 } }, "read_limits.replyMaxChars: must be between 1 and 40000"],
    [{ read_limits: { fileMaxChars: 39000, replyMaxChars: 38000 } }, "read_limits.fileMaxChars: must be <= replyMaxChars"],
    [{ max_subagents: 50 }, "max_live_subagents: must be >= max_subagents"],
  ];
  for (const [overlay, message] of cases) failsWith(withOverlay(overlay), `invalid harness config ${message}`);
  assert.equal(loadConfig(project({ io_guard: { start_rounds: 0 } }).root).io_guard.start_rounds, 0);
  assert.equal(loadConfig(project({ tiers: { pro: { provider: "" } } }).root).tiers.pro.provider, "");
});

test("CONF-06 an agent_providers entry whose main equals its worker fails in the defaults", () => {
  failsWith(() => validateConfig({ ...loadKitConfig(), agent_providers: { circle: "circle" } }),
    "invalid harness config agent_providers.circle: worker provider must differ from the main provider");
});

test("CONF-07 adapter and gsd sections are closed; .planning/config.json has no effect", () => {
  failsWith(withOverlay({ adapter: { unknown_x: 1 } }), "invalid harness config adapter.unknown_x: unknown key");
  failsWith(withOverlay({ gsd: { unknown_y: 1 } }), "invalid harness config gsd.unknown_y: unknown key");
  const p = project(undefined, { files: { ".planning/config.json": "{ garbage" } });
  assert.deepEqual(loadConfig(p.root), loadKitConfig());
  // Upstream GSD text carried unchanged (D-111, GSDC-45/47) mentions the file; kit text and code must not.
  const upstream = (f) => {
    const rel = path.relative(SHIP_DIR, f).split(path.sep).join("/");
    return rel.startsWith(".agents/gsd/upstream/") || rel.startsWith(".agents/gsd/generated/")
      || (/^\.agents\/agents\/gsd-[^/]+\.md$/.test(rel) && rel !== ".agents/agents/gsd-skeleton-reviewer.md");
  };
  const offenders = shipFiles().filter((f) => !upstream(f) && fs.readFileSync(f, "utf8").includes(".planning/config.json"));
  assert.deepEqual(offenders, []);
});

test("CONF-08 invalid overlay: strict load fails, lenient load reports and falls back to the defaults", () => {
  const broken = project(undefined);
  broken.write(".agents/harness.config.json", "{");
  assert.throws(() => loadConfig(broken.root), (e) => e instanceof ConfigError && /^invalid harness config overlay: invalid JSON \(/.test(e.message));
  const lenient = loadConfigLenient(broken.root);
  assert.match(lenient.error.message, /^invalid harness config overlay: invalid JSON/);
  assert.deepEqual(lenient.cfg, loadKitConfig());
  const unknown = loadConfigLenient(project({ typo_key: 1 }).root);
  assert.equal(unknown.error.message, "invalid harness config typo_key: unknown key");
  assert.equal(loadConfigLenient(project({ max_subagents: 3, max_live_subagents: 3 }).root).cfg.max_subagents, 3);
});

test("CONF-09 config root discovery for the file backend", () => {
  const p = project({ read_limits: { fileMaxChars: 100, replyMaxChars: 200 } }, { files: { "src/deep/a.txt": "x" } });
  assert.equal(discoverConfigRoot(p.path("src/deep"), {}), p.root);
  assert.equal(loadConfig(discoverConfigRoot(p.path("src/deep"), {})).read_limits.fileMaxChars, 100);
  const other = makeTempDir();
  assert.equal(discoverConfigRoot(other, {}), path.resolve(other));
  assert.equal(discoverConfigRoot(p.path("src"), { PASEO_HARNESS_ROOT: other }), path.resolve(other));
  const manifestOnly = makeTempProject({ git: false, files: { ".agents/harness-kit.json": "{}", "x/y.txt": "" } });
  assert.equal(discoverConfigRoot(manifestOnly.path("x"), {}), manifestOnly.root);
  failsWith(withOverlay({ typo_key: 1 }), "invalid harness config typo_key: unknown key");
});

test("CONF-10 provenance names the files and holds no kit path", () => {
  const plain = project(undefined);
  assert.deepEqual(configProvenance(plain.root), { defaults: DEFAULTS_FILE, overlay: null, manifest: null, warnings: [] });
  const withOverlayFile = project({ max_subagents: 3, max_live_subagents: 3 });
  assert.equal(configProvenance(withOverlayFile.root).overlay, path.join(withOverlayFile.root, ".agents", "harness.config.json"));
});

// Golden table of the shipped defaults: changing a default without updating this table fails (CONF-11).
const GOLDEN = {
  tiers: { frontier: { provider: "" }, pro: { provider: "" }, standard: { provider: "" } },
  tier_aliases: {},
  default_tier: "standard",
  mode: "bypassPermissions",
  allowed_models: [],
  agent_providers: { circle: "circle-agent" },
  agent_provider_disallowed_tools: ["Agent", "AskUserQuestion", "CronCreate", "CronDelete", "CronList", "DesignSync", "EnterPlanMode",
    "EnterWorktree", "ExitPlanMode", "ExitWorktree", "ListAgents", "Monitor", "PushNotification", "ReportFindings", "ScheduleWakeup",
    "SendMessage", "WebSearch", "Workflow"],
  agent_provider_env: { ENABLE_TOOL_SEARCH: "true" },
  main_provider_disallowed_tools: ["Agent", "Workflow"],
  max_subagents: 20,
  max_live_subagents: 40,
  max_agents_per_workflow: 1000,
  wait_timeout_s: 3600,
  schema_retries: 2,
  prime_role: "off",
  warmup: false,
  warmup_s: 8,
  warmup_timeout_s: 90,
  max_prompt_bytes: 262144,
  agent_nudge_s: 2700,
  agent_stop_s: 5400,
  agent_tool_stuck_s: 900,
  agent_file_tool_stuck_s: 180,
  watchdog_repeat_calls: 3,
  watchdog_same_file_reads: 6,
  watchdog_reads_without_write: 40,
  watchdog_enabled: true,
  compact_resume: "Compaction done. Continue where you left off; re-arm any Monitor you stopped.",
  context_guard: { window_tokens: 1000000, start_pct: 60, step_pct: 5 },
  io_guard: { start_rounds: 2, step_rounds: 2, edit_start_rounds: 2, edit_step_rounds: 2 },
  read_limits: { fileMaxChars: 36000, replyMaxChars: 38000 },
  worktree_dir: ".claude/worktrees",
  runs_keep: 20,
  first_prompt_note: "Read in bulk (one batched read of all needed files, not one small query per item). Batch reads and edits with the harness-files mod tools (read_ranges, edit_multiple_files, write_multiple_files) when they are enabled, otherwise use native Read/Edit/Write where owner restrictions permit. Scripts that write files must use UTF-8. Never send messages to the main/leader session: report only in the final reply of your turn. Output per response is capped, so write long documents in parts (each tool call under about 300 lines) and keep the final reply short.",
  project_prompt_note: "",
  platform_notes: { win32: "On Windows never round-trip text files through PowerShell Get-Content/Set-Content: they re-encode non-ASCII text on every pass." },
  adapter: {
    commands: { build: null, test: null, build_timeout_s: 300, test_timeout_s: 600, gates: [], verify: {}, smoke_builds: [] },
    verify_vocabulary: {
      build: { prefix: "build", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
      cmd: { prefix: "cmd:", parser: null, resolver: null, runner: null, evidence_parser: null, exit_code_sufficient: true },
    },
    ownership: { owns_forms: [{ prefix: "Path:", maps_to: "<path>" }], shared: { globs: [], predicate: null }, source_roots: [], ignore: [], regenerated: [] },
    review_lenses: [],
    syntax_checkers: {},
    instructions: [],
    envelope: null,
    stack_skill: null,
    agents: {},
    mutex: null,
    startup_globs: [],
    smoke_triggers: [
      "**/pubspec.yaml", "**/pubspec.lock", "**/package.json", "**/package-lock.json", "**/Cargo.toml", "**/Cargo.lock",
      "**/go.mod", "**/go.sum", "**/pyproject.toml", "**/requirements*.txt", "**/Podfile", "**/Podfile.lock",
      "**/build.gradle*", "**/settings.gradle*", "**/CMakeLists.txt",
    ],
    hook_timeout_s: 30,
    dependency_probe: null,
    dependency_probe_timeout_s: 300,
    attribution: null,
    worktree_setup: { copy: [], link: [] },
  },
  gsd: {
    roles: {},
    granularity: "standard",
    plan_limits: { tasks_per_plan: 3, plans_per_phase: 12, waves_per_phase: 4 },
    tracer_extra_files: 0,
    execution_mode: "per-wave",
    execute_schedule: "waves",
    batch_review: true,
    isolation: "worktree",
    fixer_verifies_itself: true,
    max_verify_rounds: 4,
    commit_policy: { docs: false, code: "per-wave" },
    branching: "none",
    protected_branches: [],
    requirement_id_regex: "^[A-Z][A-Z0-9]*-\\d+$",
    research: true,
    research_ahead: false,
    plan_review: false,
    plan_flow: "staged",
    skeleton_lanes: [{ lens: "fidelity" }, { lens: "integration" }],
    max_skeleton_passes: 3,
    max_check_iterations: 3,
    drift_threshold: 3,
    map_mode: "whole",
    debug: { max_turns: 16, minutes: 120 },
    fixer: { max_build_attempts: 3, minutes: 60 },
    parallelization: { enabled: true, max_concurrent: null },
    code_review: { max_concurrent: 1, reviewers: [] },
    review_depth: "standard",
    verify_mode: "phase",
  },
};

test("CONF-11 shipped defaults equal the golden table", () => {
  assert.deepEqual(loadKitConfig(), GOLDEN);
});

test("CONF-11 no provider/model id outside _notes; an overlay tier mapping resolves without kit edits", () => {
  const raw = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
  delete raw._notes;
  const text = JSON.stringify(raw);
  const ids = [...text.matchAll(/"([A-Za-z0-9._-]+\/[A-Za-z0-9._[\]-]+)"/g)].map((m) => m[1]).filter((id) => !id.startsWith(".claude/"));
  assert.deepEqual(ids, []);
  assert.ok(!text.includes("[1m]"));
  const cfg = loadConfig(project({ tiers: { standard: { provider: "circle/m-1[1m]", thinking: "low" } } }).root);
  assert.equal(cfg.tiers.standard.provider, "circle/m-1[1m]");
  assert.equal(cfg.tiers.pro.provider, "");
});

test("CONF-12 lint: no other shipped module opens the defaults or the overlay by name", () => {
  const own = path.join(SHIP_DIR, ".agents", "harness", "config.mjs");
  const offenders = shipFiles()
    .filter((f) => /\.(mjs|js|ts)$/.test(f) && f !== own)
    // FTOL-05 requires the defaults file in the backend's trusted set (hashed, never loaded as config).
    .filter((f) => /["'`][^"'`\n]*harness\.(defaults|config)\.json/.test(fs.readFileSync(f, "utf8").replace(/TRUSTED_FIXED = [^\]]*\]/g, "")));
  assert.deepEqual(offenders, []);
});

test("CONF-13 dropped locations and keys", () => {
  const legacy = makeTempProject({ git: false, files: { ".claude/harness.config.json": '{"max_subagents": 1}' } });
  assert.equal(loadConfig(legacy.root).max_subagents, 20);
  failsWith(withOverlay({ context_guard: { model_pattern: "." } }), "invalid harness config context_guard.model_pattern: unknown key");
  failsWith(withOverlay({ agent_mcp: {} }), "invalid harness config agent_mcp: unknown key");
  failsWith(withOverlay({ modes: {} }), "invalid harness config modes: unknown key");
  failsWith(withOverlay({ provider_features: {} }), "invalid harness config provider_features: unknown key");
  failsWith(withOverlay({ read_limits: { mediaPerTurn: 1 } }), "invalid harness config read_limits.mediaPerTurn: unknown key");
});

test("CONF-14 complete key table; first_prompt_note is kit-owned, project_prompt_note is the project's", () => {
  assert.deepEqual([...TOP_LEVEL_KEYS], [
    "tiers", "tier_aliases", "default_tier", "mode", "allowed_models", "agent_providers", "agent_provider_disallowed_tools",
    "agent_provider_env", "main_provider_disallowed_tools", "max_subagents", "max_live_subagents", "max_agents_per_workflow",
    "wait_timeout_s", "schema_retries", "prime_role", "warmup", "warmup_s", "warmup_timeout_s", "max_prompt_bytes", "agent_nudge_s",
    "agent_stop_s", "agent_tool_stuck_s", "agent_file_tool_stuck_s", "watchdog_repeat_calls", "watchdog_same_file_reads",
    "watchdog_reads_without_write", "watchdog_enabled", "compact_resume", "context_guard", "io_guard", "read_limits", "worktree_dir",
    "runs_keep", "first_prompt_note", "project_prompt_note", "platform_notes", "adapter", "gsd",
  ]);
  assert.ok(KIT_OWNED_KEYS.includes("first_prompt_note"));
  const cfg = loadConfig(project({ first_prompt_note: "X", project_prompt_note: "P", max_live_subagents: 50, watchdog_enabled: false, warmup: true, warmup_s: 3 }).root);
  assert.equal(cfg.first_prompt_note, GOLDEN.first_prompt_note);
  assert.equal(cfg.project_prompt_note, "P");
  assert.equal(cfg.max_live_subagents, 50);
  assert.equal(cfg.watchdog_enabled, false);
  assert.equal(cfg.warmup, true);
  assert.equal(cfg.warmup_s, 3);
  assert.ok(cfg.first_prompt_note.includes("main/leader session") && cfg.first_prompt_note.includes("300 lines"));
  assert.ok(!/fsbatch|mcp__filesystem/.test(fs.readFileSync(DEFAULTS_FILE, "utf8")));
});

test("ADPT-14 partial nested gsd and adapter entries name every missing key; cross-key adapter rules", () => {
  failsWith(withOverlay({ gsd: { plan_limits: { plans_per_phase: 15 } } }),
    "invalid harness config gsd.plan_limits.tasks_per_plan: missing key (also missing: waves_per_phase)");
  failsWith(withOverlay({ adapter: { commands: { build: ["make"] } } }),
    "invalid harness config adapter.commands.test: missing key (also missing: build_timeout_s, test_timeout_s, gates, verify)");
  failsWith(withOverlay({ gsd: { max_check_iterations: 4 } }), "invalid harness config gsd.max_check_iterations: must be between 1 and 3");
  failsWith(withOverlay({ adapter: { verify_vocabulary: { test: { prefix: "test:", parser: null, resolver: null, runner: "unit", evidence_parser: null, exit_code_sufficient: false } } } }),
    "invalid harness config adapter.verify_vocabulary.test.runner: must name a key of adapter.commands.verify");
  assert.throws(withOverlay({ adapter: { agents: { nosuch: "x" } } }), /invalid harness config adapter\.agents\.nosuch: unknown GSD role/);
  assert.throws(withOverlay({ gsd: { requirement_id_regex: "(" } }), /invalid harness config gsd\.requirement_id_regex: invalid regular expression/);
  assert.throws(withOverlay({ gsd: { roles: { planner: { model: "nosuch" } } } }), /gsd\.roles\.planner\.model: must name a tier/);
  const whole = loadConfig(project({ gsd: { plan_limits: { tasks_per_plan: 3, plans_per_phase: 15, waves_per_phase: 4 }, roles: { reviewer: { model: "pro", effort: "high" } } } }).root);
  assert.equal(whole.gsd.plan_limits.plans_per_phase, 15);
  assert.equal(whole.gsd.execution_mode, "per-wave");
  assert.deepEqual(whole.gsd.roles, { reviewer: { model: "pro", effort: "high" } });
});
