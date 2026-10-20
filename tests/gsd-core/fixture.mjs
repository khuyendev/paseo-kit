// Fixture projects for the gsd-core tests: a .planning tree with a roadmap, requirements and phases (paths with spaces).
import { makeTempProject } from "../helpers/temp.mjs";
import { testEnv } from "../helpers/env.mjs";
import { textDigest } from "../../ship/.agents/harness/lib/hash.mjs";
import { runGsd } from "../../ship/.agents/harness/gsd/commands.mjs";

export const ROADMAP = `# Roadmap: Fixture

## Phases

- [ ] **Phase 1: Core** - the core
- [ ] **Phase 2: Api** - the api
- [ ] **Phase 3: Ui** - the ui

## Phase Details

### Phase 1: Core
**Goal**: Core works
**Depends on**: Nothing (first phase)
**Requirements**: [CORE-01, CORE-02]
**Success Criteria** (what must be TRUE):
  1. Core runs
  2. Core is tested
**Plans**: 2 plans

### Phase 2: Api
**Goal**: Api works
**Depends on**: Phase 1
**Requirements**: API-01
**Success Criteria** (what must be TRUE):
  1. Api answers
**Plans**: TBD

### Phase 3: Ui
**Goal**: Ui works
**Depends on**: Phase 2
**Requirements**: TBD
**Success Criteria** (what must be TRUE):
  1. Ui shows
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Core | 0/2 | Not started | - |
| 2. Api | 0/0 | Not started | - |
| 3. Ui | 0/0 | Not started | - |
`;

export const REQUIREMENTS = `# Requirements: Fixture

## v1 Requirements

- [ ] **CORE-01**: Core starts
- [ ] **CORE-02**: Core stops
- [ ] **API-01**: Api answers

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CORE-01 | Phase 1 | Pending |
| CORE-02 | Phase 1 | Pending |
| API-01 | Phase 2 | Pending |
`;

// A valid plan; `over` replaces frontmatter lines, `tasks` the task block.
export function plan({ phase = "01", id = "01", wave = 1, depends = "[]", files = "[src/a.js]", owns = "[\"Path:src/a.js\"]", reqs = "[CORE-01]", extra = "", tasks } = {}) {
  return `---
phase: ${phase}-core
plan: ${id}
type: execute
wave: ${wave}
depends_on: ${depends}
files_modified: ${files}
owns: ${owns}
autonomous: true
requirements: ${reqs}
must_haves:
  truths:
    - "Core runs"
${extra}---

<objective>Build part ${id}</objective>

<tasks>
${tasks ?? `<task type="auto">
  <name>Task one</name>
  <files>src/a.js</files>
  <action>Write it</action>
  <verify>
    <automated>cmd: node src/a.js</automated>
    <fails_when>node prints an error and exits non-zero</fails_when>
  </verify>
  <done>works</done>
</task>`}
</tasks>
`;
}

export function project({ files = {}, overlay, git = true, roadmap = ROADMAP, requirements = REQUIREMENTS } = {}) {
  const base = { ".planning/ROADMAP.md": roadmap, ".planning/REQUIREMENTS.md": requirements, ".planning/PROJECT.md": "# Project\n", ".planning/phases/01-core/.keep": "", ".planning/phases/02-api/.keep": "", ".planning/phases/03-ui/.keep": "" };
  for (const [k, v] of Object.entries(files)) if (v === null) delete base[k];
  const all = { ...base, ...Object.fromEntries(Object.entries(files).filter(([, v]) => v !== null)) };
  return makeTempProject({ git, files: all, overlay });
}

// In-process ph gsd: {code, json, out, err, stdout}.
export async function gsd(p, argv, { env = testEnv(), stdin } = {}) {
  const out = [];
  const err = [];
  let stdout = "";
  const code = await runGsd(argv, {
    env,
    root: p.root ?? p,
    stdin,
    out: (l) => {
      out.push(l);
      stdout += `${l}\n`;
    },
    err: (l) => err.push(l),
    write: (t) => (stdout += t),
    errWrite: (t) => err.push(t),
  });
  let json = null;
  try {
    json = JSON.parse(out.at(-1) ?? "null");
  } catch {
    json = null;
  }
  return { code, json, out, err, stdout };
}

export const workerEnv = () => testEnv({ PASEO_HARNESS_ROLE: "worker" });

export const P1 = ".planning/phases/01-core";
export const summary = (id) => `---\nphase: 01-core\nplan: ${id}\nkey-files:\n  created: [src/a.js]\n  modified: []\n---\n# Summary ${id}\n`;

// A VERIFICATION report with a correct fingerprint over the phase plans, summaries and src/a.js.
export async function writeVerification(p, status, { gaps = [], human = [], raw } = {}) {
  const fp = (await gsd(p, ["verification", "fingerprint", "1", "src/a.js"])).json;
  const list = (k, items) => (items.length ? `${k}:\n${items.map((x) => `  - truth: "${x}"`).join("\n")}\n` : "");
  const text = raw ?? `---\nphase: 01-core\nstatus: ${status}\nscore: 2/2\ncovered_files:\n${fp.covered_files.map((f) => `  - ${f}`).join("\n")}\ncovered_digest: "${fp.covered_digest}"\n${list("gaps", gaps)}${list("human_verification", human)}---\n# Verification\n`;
  p.write(`${P1}/01-VERIFICATION.md`, text);
  return textDigest(text);
}

