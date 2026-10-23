// Real-engine fixture of the TI tests: a temp root whose `ph.mjs` is a stub (config, gsd hash) and whose gsd-flow.mjs runs
// the kit's real flow verbs against that root, so the engine's helper globals make real shell calls.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runWorkflow } from "../../ship/.agents/harness/workflow/engine.mjs";
import { SHIP_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakeHost } from "../workflow/helpers.mjs";

const REAL_FLOW = pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href;
export const OLD_BLOCK = fs.readFileSync(new URL("./fixtures/TI-old-helpers.js.txt", import.meta.url), "utf8").replace(/\r\n/g, "\n");
export const META = 'export const meta = { name: "ti", description: "TI helper globals" };\n';

const PH_STUB = `import crypto from "node:crypto";
import fs from "node:fs";
const [cmd, verb] = process.argv.slice(2);
if (cmd === "config") console.log(JSON.stringify({ adapter: { agents: {} }, gsd: { mode: "stub" } }));
else if (cmd === "gsd" && verb === "hash") console.log(JSON.stringify({ hash: crypto.createHash("sha256").update(fs.readFileSync(0, "utf8")).digest("hex").slice(0, 12) }));
else { console.log(JSON.stringify({ status: "unavailable", verb })); process.exitCode = 69; }
`;
const FLOW_STUB = `import fs from "node:fs";
const { main, readsStdin } = await import(process.env.TI_REAL_FLOW);
const cmd = process.argv[2];
process.exitCode = await main(process.argv.slice(2), { root: process.cwd(), input: readsStdin(cmd) ? fs.readFileSync(0, "utf8") : "" });
`;

export function stubRoot(files = {}) {
  const root = makeTempDir("ti engine ");
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text, "utf8");
  };
  write(".agents/harness/ph.mjs", PH_STUB);
  write(".agents/workflows/lib/gsd-flow.mjs", FLOW_STUB);
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  return root;
}

export async function runEngine(root, source, { journalPath, cache, host = fakeHost() } = {}) {
  const out = [];
  const r = await runWorkflow({
    source, scriptPath: "ti.js", runId: "wf_ti", root, env: { ...process.env, TI_REAL_FLOW: REAL_FLOW },
    limits: { maxConcurrent: 4, maxAgents: 100, budgetTotal: null, shellTimeoutS: 60 }, journalPath, cache, out: (l) => out.push(l),
    resolveChild: () => { throw new Error("no child workflows here"); }, host,
  });
  return { ...r, out, host };
}

// The script as an old kit shipped it: the copied helper block right after meta.
export const oldScript = (body) => `${META}\n${OLD_BLOCK}\n${body}`;
export const newScript = (body) => `${META}\n${body}`;
