// Closed schema of the harness config: types and rules only. Every shipped value lives in harness.defaults.json
// (CONF-05), so this module holds no default value.
import path from "node:path";

export class ConfigError extends Error {
  constructor(key, message, text = `invalid harness config ${key}: ${message}`) {
    super(text);
    this.name = "ConfigError";
    this.key = key;
  }
}

export const THINKING_LEVELS = Object.freeze(["off", "low", "medium", "high", "xhigh", "max"]);

export const GSD_ROLES = Object.freeze([
  "research", "project_researcher", "synthesizer", "outline", "planner", "checker", "skeleton_lane", "architect",
  "plan_finder", "plan_verifier", "plan_judge", "plan_editor", "executor", "reviewer", "finding_verifier", "fixer",
  "verifier", "mapper", "map_reviewer", "roadmapper", "debugger",
]);

const MODEL_ID = /^[^/]+\/.+$/;
const NAME = /^[A-Za-z0-9._-]+$/;
// The largest reply the file tools return in one page (FTOL-23).
const READ_PAGE_CHARS = 40000;

// A repo-relative path after normalizing: no drive, no leading slash, no `.` or `..` that leaves the repo (the docs'
// contract; lint also checks where a link inside the repo leads).
const leavesRepo = (v) => {
  const p = path.posix.normalize(v.replace(/\\/g, "/"));
  return /^[A-Za-z]:|^\//.test(p) || p === "." || p === ".." || p.startsWith("../");
};
const REPO_PATH_TEXT = "expected a repo-relative path (no drive, leading slash or ..)";

const int = (min = 0, max) => ({ kind: "int", min, max });
const bool = () => ({ kind: "bool" });
const str = (rules = {}) => ({ kind: "str", ...rules });
const strs = (rules = {}) => ({ kind: "strs", ...rules });
const arr = (of, min = 0) => ({ kind: "arr", of, min });
const obj = (fields, optional = []) => ({ kind: "obj", fields, optional: new Set(optional) });
const map = (of, keyPattern) => ({ kind: "map", of, keyPattern });
const nullable = (of) => ({ kind: "nullable", of });
const anyObj = () => ({ kind: "anyObj" });

const argv = () => ({ kind: "strs", min: 1 });
const effort = () => str({ oneOf: THINKING_LEVELS });

export const SCHEMA = obj({
  tiers: map(obj({ provider: str({ pattern: /^$|^[^/]+\/.+$/, patternText: '"" or provider/model' }), thinking: effort(), features: anyObj() }, ["thinking", "features"])),
  tier_aliases: map(str({ nonEmpty: true })),
  default_tier: str({ nonEmpty: true }),
  mode: str({ nonEmpty: true }),
  allowed_models: strs(),
  agent_providers: map(str({ nonEmpty: true })),
  agent_provider_disallowed_tools: strs(),
  agent_provider_env: map(str()),
  main_provider_disallowed_tools: strs(),
  max_subagents: int(1),
  max_live_subagents: int(1),
  max_agents_per_workflow: int(1),
  wait_timeout_s: int(1),
  schema_retries: int(),
  prime_role: str({ oneOf: ["two-turn", "off"] }),
  warmup: bool(),
  warmup_s: int(),
  warmup_timeout_s: int(),
  max_prompt_bytes: int(1),
  agent_nudge_s: int(),
  agent_stop_s: int(),
  agent_tool_stuck_s: int(),
  agent_file_tool_stuck_s: int(),
  watchdog_repeat_calls: int(),
  watchdog_same_file_reads: int(),
  watchdog_reads_without_write: int(),
  watchdog_enabled: bool(),
  compact_resume: str(),
  context_guard: obj({ window_tokens: int(1), start_pct: int(1, 100), step_pct: int(1, 100) }),
  io_guard: obj({ start_rounds: int(), step_rounds: int(1), edit_start_rounds: int(), edit_step_rounds: int(1) }),
  read_limits: obj({ fileMaxChars: int(1), replyMaxChars: int(1, READ_PAGE_CHARS) }),
  worktree_dir: str({ nonEmpty: true, repoPath: true }),
  runs_keep: int(),
  first_prompt_note: str(),
  project_prompt_note: str(),
  platform_notes: map(str()),
  adapter: obj({
    commands: obj({
      build: nullable(argv()),
      test: nullable(argv()),
      build_timeout_s: int(1),
      test_timeout_s: int(1),
      gates: arr(obj({ name: str({ nonEmpty: true }), argv: argv() })),
      verify: map(obj({ argv: argv(), timeout_s: int(1) })),
      // F50: one argv per declared verification target, built once before planning (gsd-plan stage Smoke build).
      smoke_builds: arr(argv()),
    }, ["smoke_builds"]),
    verify_vocabulary: map(obj({
      prefix: str({ nonEmpty: true }),
      parser: nullable(str({ nonEmpty: true, repoPath: true })),
      resolver: nullable(str({ nonEmpty: true, repoPath: true })),
      runner: nullable(str({ nonEmpty: true })),
      evidence_parser: nullable(str({ nonEmpty: true, repoPath: true })),
      exit_code_sufficient: bool(),
    })),
    ownership: obj({
      owns_forms: arr(obj({ prefix: str({ nonEmpty: true }), maps_to: str({ nonEmpty: true }) })),
      shared: obj({ globs: strs(), predicate: nullable(str({ nonEmpty: true, repoPath: true })) }),
      source_roots: strs(),
      ignore: strs(),
      regenerated: strs(),
    }, ["ignore", "regenerated"]),
    review_lenses: arr(obj({
      name: str({ nonEmpty: true }),
      text: str({ nonEmpty: true }),
      stage: str({ oneOf: ["skeleton", "plan_review", "code"] }),
      applies_to: strs(),
    }, ["stage", "applies_to"])),
    syntax_checkers: map(obj({ argv: argv(), timeout_s: int(1), max_parallel: int(1) }, ["timeout_s", "max_parallel"]), /^\.[^./\\]+$/),
    instructions: strs({ repoPath: true }),
    envelope: nullable(arr(obj({ axis: str({ nonEmpty: true }), values: arr(null), range: arr(null), source: str({ nonEmpty: true }) }, ["values", "range"]))),
    stack_skill: nullable(str({ pattern: NAME, patternText: "a skill folder name" })),
    agents: map(str({ pattern: NAME, patternText: "an agent type name" })),
    mutex: nullable(str({ nonEmpty: true })),
    startup_globs: strs(),
    // F57: globs of dependency manifests and native-asset package files; a wave that changes one runs commands.smoke_builds once per phase.
    smoke_triggers: strs(),
    hook_timeout_s: int(1),
    // G022: the argv that checks the dependency set the plans declare; null = no probe.
    dependency_probe: nullable(argv()),
    dependency_probe_timeout_s: int(1),
    attribution: nullable(str({ nonEmpty: true, repoPath: true })),
    worktree_setup: obj({ copy: strs(), link: strs() }),
  }),
  gsd: obj({
    roles: map(obj({ model: str({ nonEmpty: true }), effort: effort(), reason: str() }, ["model", "effort", "reason"])),
    granularity: str({ oneOf: ["coarse", "standard", "fine"] }),
    plan_limits: obj({ tasks_per_plan: int(1), plans_per_phase: int(1), waves_per_phase: int(1) }),
    tracer_extra_files: int(0),
    // kit-feedback 69: the Files/plan lines of the outline check, the probe and the checker prompt; null = 10/15 raised to the phase average + 1.
    files_per_plan: nullable(obj({ warning: int(1), blocker: int(1) })),
    execution_mode: str({ oneOf: ["per-wave", "batch"] }),
    // kit-feedback 66: graph starts each plan when the plans it depends on are committed (per-wave execution only).
    execute_schedule: str({ oneOf: ["waves", "graph"] }),
    batch_review: bool(),
    isolation: str({ oneOf: ["shared", "worktree"] }),
    fixer_verifies_itself: bool(),
    max_verify_rounds: int(1),
    commit_policy: obj({ docs: bool(), code: str({ oneOf: ["per-wave", "per-plan"] }) }),
    branching: str({ oneOf: ["none", "phase"] }),
    protected_branches: strs(),
    requirement_id_regex: str({ nonEmpty: true }),
    research: bool(),
    research_ahead: bool(),
    plan_review: bool(),
    // Kit feedback 72: resolve = the staged plan review judges convergence by its open issues; fresh = by fresh-review counts.
    plan_review_check: str({ oneOf: ["resolve", "fresh"] }),
    plan_flow: str({ oneOf: ["staged", "streams"] }),
    // kit-feedback 69, 76: reallocation rounds a run may take when the checker sends plans back to the outline (0 = off); recheck scope.
    checker_reallocate: int(0, 2),
    checker_recheck: str({ oneOf: ["full", "incremental"] }),
    skeleton_lanes: arr(obj({ lens: str({ nonEmpty: true }), model: str({ nonEmpty: true }), effort: effort() }, ["model", "effort"]), 1),
    max_skeleton_passes: int(1, 3),
    max_check_iterations: int(1, 3),
    drift_threshold: int(),
    map_mode: str({ oneOf: ["whole", "per-focus"] }),
    debug: obj({ max_turns: int(1), minutes: int(1) }),
    fixer: obj({ max_build_attempts: int(1), minutes: int(1) }),
    code_review: obj({ max_concurrent: int(1), reviewers: arr(obj({ model: str({ nonEmpty: true }), effort: effort() }, ["model", "effort"])) }),
    parallelization: obj({ enabled: bool(), max_concurrent: nullable(int(1)) }),
    review_depth: str({ oneOf: ["quick", "standard", "deep"] }),
    // Kit feedback 66: phase = one verifier for the whole phase; per-criterion = one verifier per ROADMAP success criterion.
    verify_mode: str({ oneOf: ["phase", "per-criterion"] }),
    // Kit feedback 64: pre-code review records, the plan-catchable tag and plan-defect events (measurement only).
    review_metrics: bool(),
    // Kit feedback 70: gsd-plan renders <NN>-VALIDATION.md (upstream plan-phase step 5.5) for the checker's Dimension 8.
    validation_strategy: bool(),
  }),
});

export const TOP_LEVEL_KEYS = Object.freeze(Object.keys(SCHEMA.fields));

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function describe(node) {
  switch (node.kind) {
    case "int": return "integer";
    case "bool": return "boolean";
    case "str": return "string";
    case "strs": return "array of strings";
    case "arr": return "array";
    case "nullable": return `null or ${describe(node.of)}`;
    default: return "object";
  }
}

function checkInt(node, value, key) {
  if (!Number.isSafeInteger(value)) throw new ConfigError(key, "expected integer");
  if (node.max !== undefined && (value < node.min || value > node.max)) {
    throw new ConfigError(key, `must be between ${node.min} and ${node.max}`);
  }
  if (value < node.min) throw new ConfigError(key, `must be >= ${node.min}`);
}

function checkStr(node, value, key) {
  if (typeof value !== "string") throw new ConfigError(key, "expected string");
  if (node.nonEmpty && !value) throw new ConfigError(key, "must not be empty");
  if (node.oneOf && !node.oneOf.includes(value)) throw new ConfigError(key, `expected one of ${node.oneOf.join("|")}`);
  if (node.pattern && !node.pattern.test(value)) throw new ConfigError(key, `expected ${node.patternText}`);
  if (node.repoPath && leavesRepo(value)) throw new ConfigError(key, REPO_PATH_TEXT);
}

function checkFields(node, value, key) {
  for (const name of Object.keys(value)) {
    if (!Object.hasOwn(node.fields, name)) throw new ConfigError(`${key}.${name}`, "unknown key");
  }
  // A partial nested entry names every missing key at once (ADPT-14).
  const missing = Object.keys(node.fields).filter((name) => !Object.hasOwn(value, name) && !node.optional.has(name));
  if (missing.length) {
    const more = missing.length > 1 ? ` (also missing: ${missing.slice(1).join(", ")})` : "";
    throw new ConfigError(`${key}.${missing[0]}`, `missing key${more}`);
  }
  for (const [name, child] of Object.entries(node.fields)) {
    if (Object.hasOwn(value, name)) check(child, value[name], `${key}.${name}`);
  }
}

function check(node, value, key) {
  switch (node.kind) {
    case "int": return checkInt(node, value, key);
    case "bool":
      if (typeof value !== "boolean") throw new ConfigError(key, "expected boolean");
      return;
    case "str": return checkStr(node, value, key);
    case "strs":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) throw new ConfigError(key, "expected array of strings");
      if (node.min && (value.length < node.min || value.some((v) => !v))) throw new ConfigError(key, "expected a non-empty argv array");
      if (node.repoPath) value.forEach((v, i) => { if (leavesRepo(v)) throw new ConfigError(`${key}[${i}]`, REPO_PATH_TEXT); });
      return;
    case "arr":
      if (!Array.isArray(value)) throw new ConfigError(key, "expected array");
      if (value.length < node.min) throw new ConfigError(key, `needs at least ${node.min} entry`);
      if (node.of) value.forEach((v, i) => check(node.of, v, `${key}[${i}]`));
      return;
    case "nullable":
      if (value === null) return;
      try {
        return check(node.of, value, key);
      } catch (e) {
        if (e instanceof ConfigError && e.key === key && e.message.endsWith(`expected ${describe(node.of)}`)) {
          throw new ConfigError(key, `expected ${describe(node)}`);
        }
        throw e;
      }
    case "anyObj":
      if (!isObject(value)) throw new ConfigError(key, "expected object");
      return;
    case "map":
      if (!isObject(value)) throw new ConfigError(key, "expected object");
      for (const [name, v] of Object.entries(value)) {
        if (node.keyPattern && !node.keyPattern.test(name)) throw new ConfigError(`${key}.${name}`, "invalid key name");
        check(node.of, v, `${key}.${name}`);
      }
      return;
    case "obj":
      if (!isObject(value)) throw new ConfigError(key, "expected object");
      return checkFields(node, value, key);
  }
}

const isModelId = (v) => MODEL_ID.test(v);

// Rules that relate one key to another (CONF-06, ADPT-03, ADPT-09, ADPT-11).
function checkRelations(cfg) {
  const isTier = (v) => Object.hasOwn(cfg.tiers, v);
  const isAlias = (v) => Object.hasOwn(cfg.tier_aliases, v);
  const isModelSpec = (v) => isTier(v) || isAlias(v) || isModelId(v);
  if (!isModelSpec(cfg.default_tier)) throw new ConfigError("default_tier", "must name a tier, an alias or a provider/model");
  for (const [name, target] of Object.entries(cfg.tier_aliases)) {
    if (!isTier(target) && !isModelId(target)) throw new ConfigError(`tier_aliases.${name}`, "must name a tier or a provider/model");
  }
  for (const [main, worker] of Object.entries(cfg.agent_providers)) {
    if (main === worker) throw new ConfigError(`agent_providers.${main}`, "worker provider must differ from the main provider");
  }
  if (cfg.max_live_subagents < cfg.max_subagents) throw new ConfigError("max_live_subagents", "must be >= max_subagents");
  if (cfg.read_limits.fileMaxChars > cfg.read_limits.replyMaxChars) throw new ConfigError("read_limits.fileMaxChars", "must be <= replyMaxChars");
  for (const [role, entry] of Object.entries(cfg.gsd.roles)) {
    if (entry.model !== undefined && !isModelSpec(entry.model)) throw new ConfigError(`gsd.roles.${role}.model`, "must name a tier, an alias or a provider/model");
  }
  cfg.gsd.skeleton_lanes.forEach((lane, i) => {
    if (lane.model !== undefined && !isModelSpec(lane.model)) throw new ConfigError(`gsd.skeleton_lanes[${i}].model`, "must name a tier, an alias or a provider/model");
  });
  try {
    new RegExp(cfg.gsd.requirement_id_regex);
  } catch (e) {
    throw new ConfigError("gsd.requirement_id_regex", `invalid regular expression (${e.message})`);
  }
  const verifyRunners = cfg.adapter.commands.verify;
  for (const [kind, entry] of Object.entries(cfg.adapter.verify_vocabulary)) {
    if (entry.runner !== null && !Object.hasOwn(verifyRunners, entry.runner)) {
      throw new ConfigError(`adapter.verify_vocabulary.${kind}.runner`, "must name a key of adapter.commands.verify");
    }
  }
  for (const role of Object.keys(cfg.adapter.agents)) {
    if (!GSD_ROLES.includes(role)) throw new ConfigError(`adapter.agents.${role}`, `unknown GSD role (roles: ${GSD_ROLES.join(", ")})`);
  }
  (cfg.adapter.envelope ?? []).forEach((axis, i) => {
    if (Object.hasOwn(axis, "values") === Object.hasOwn(axis, "range")) throw new ConfigError(`adapter.envelope[${i}]`, "needs exactly one of values or range");
  });
}

// Throws ConfigError naming the dotted key; returns cfg when valid.
export function validateAgainstSchema(cfg) {
  if (!isObject(cfg)) throw new ConfigError("config", "expected an object");
  for (const name of Object.keys(cfg)) {
    if (!Object.hasOwn(SCHEMA.fields, name)) throw new ConfigError(name, "unknown key");
  }
  for (const name of TOP_LEVEL_KEYS) {
    if (!Object.hasOwn(cfg, name)) throw new ConfigError(name, "missing key");
  }
  for (const [name, node] of Object.entries(SCHEMA.fields)) check(node, cfg[name], name);
  checkRelations(cfg);
  return cfg;
}
