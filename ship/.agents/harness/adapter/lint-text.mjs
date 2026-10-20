// Text checks shared by every linted file: in-session primitives (HARN-06) and named references (HARN-07).

export const PRIMITIVES = Object.freeze(["Agent", "Workflow", "SendMessage", "TaskCreate", "TaskUpdate", "TaskList", "TaskGet", "TaskStop", "TeamCreate", "TeamDelete"]);
// `Agent` and `Workflow` are ordinary words too: a bare mention of them is not even a warning.
const DISTINCT = PRIMITIVES.filter((p) => p !== "Agent" && p !== "Workflow");
const LIST_PREFIX = String.raw`^\s*(?:>\s*)?(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*)?`;

const CALL = new RegExp(String.raw`\b(${PRIMITIVES.join("|")})\(`, "g");
// HARN-06 (CR-HAR-07): an instruction line starting with Use/Call and a primitive name fails for every primitive.
const IMPERATIVE = new RegExp(String.raw`${LIST_PREFIX}(?:Use|Call)\s+(?:the\s+)?\x60?(${PRIMITIVES.join("|")})\b`);
const TEAM_SET = /\b(team_name|CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS)\s*["']?\s*[:=]/;
const BARE = new RegExp(String.raw`\b(${[...DISTINCT, "team_name", "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", "broadcast"].join("|")})\b`, "g");

// Returns [{level, line, msg}] for one file's text.
export function scanPrimitives(text) {
  const findings = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const failed = new Set();
    const fail = (name, msg) => {
      failed.add(name);
      findings.push({ level: "fail", line: i + 1, msg });
    };
    for (const m of line.matchAll(CALL)) fail(m[1], `operational use of the in-session primitive ${m[1]}( (use ph)`);
    const imp = line.match(IMPERATIVE);
    if (imp && !failed.has(imp[1])) fail(imp[1], `instruction to use the in-session primitive ${imp[1]} (use ph)`);
    const team = line.match(TEAM_SET);
    if (team) fail(team[1], `${team[1]} is set (v1 team mechanism)`);
    for (const m of line.matchAll(BARE)) {
      if (!failed.has(m[1])) findings.push({ level: "warn", line: i + 1, msg: `mentions ${m[1]}` });
      failed.add(m[1]);
    }
  });
  return findings;
}

const NAME = "([A-Za-z0-9._-]*[a-z][A-Za-z0-9._-]*)";
const AGENT_TYPE = new RegExp(String.raw`\bagentType\s*:\s*['"\x60]${NAME}['"\x60]`, "g");
const TYPE_FLAG = new RegExp(String.raw`--type[ =]${NAME}`, "g");
const FANOUT_TYPE = new RegExp(String.raw`\btype=${NAME}`, "g");
const SKILL_PATH = new RegExp(String.raw`\.claude/skills/${NAME}/`, "g");
const AGENT_PATH = new RegExp(String.raw`\.agents/agents/${NAME}\.md`, "g");
// HARN-07 (CR-HAR-06): the workflow script a `ph workflow --script <path>` invocation runs.
const SCRIPT_FLAG = /--script[ =]["'`]?((?:\.\/)?[\w@.-]+(?:\/[\w@.-]+)*\.[cm]?js)\b/g;

// Agent types, skills and workflow scripts a file names: [{kind: agent|skill|script, name, line}].
export function extractReferences(text) {
  const refs = [];
  String(text).split(/\r?\n/).forEach((line, i) => {
    const add = (kind, re) => {
      for (const m of line.matchAll(re)) refs.push({ kind, name: m[1], line: i + 1 });
    };
    add("agent", AGENT_TYPE);
    add("agent", TYPE_FLAG);
    if (/^===\s/.test(line)) add("agent", FANOUT_TYPE);
    add("agent", AGENT_PATH);
    add("skill", SKILL_PATH);
    add("script", SCRIPT_FLAG);
  });
  return refs;
}
