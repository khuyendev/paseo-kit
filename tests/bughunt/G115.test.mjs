// G115: the debugger writes its session file, which the session's owns does not list. The runtime adapter names the
// session file as the one write outside owns, and both debugger overlays state the same exception.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { SHIP_DIR } from "../helpers/temp.mjs";
import { runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const SESSION = ".planning/debug/login-fails.md";
// Line endings depend on the checkout (core.autocrlf on Windows); these checks compare text, not bytes.
const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");

// The fake debug verbs of misc.test.mjs (GSDC-43 contract, simplified): one session with owns Path:src/login/.
function debugWorld() {
  const w = makeWorld({ overlay: { gsd: { debug: { max_turns: 3, minutes: 120 } } } });
  const s = { path: SESSION, frontmatter: { goal: "find_and_fix", owns: ["Path:src/login/"], budget_used: { turns: 0, minutes: 0 } } };
  w.gsd.on("debug status", () => ({ status: "investigating", path: s.path, frontmatter: s.frontmatter }));
  w.gsd.on("debug budget", () => ({ ok: true }));
  return w;
}

test("G115 the runtime adapter names the session file as the one write outside owns and leaves owns unchanged", async () => {
  const w = debugWorld();
  const r = await runScript("gsd-debug", { root: w.root, gsd: w.gsd, args: { slug: "login-fails" }, agent: () => ({ status: "checkpoint", checkpoint: { id: "c1", type: "decision", question: "which?", options: ["a"] } }) });
  const adapter = /<runtime_adapter>\n([\s\S]*?)\n<\/runtime_adapter>/.exec(r.calls[0].prompt)?.[1] ?? "";
  assert.match(adapter, /^Edit scope \(owns\): \["Path:src\/login\/"\]; never a shared file/m);
  assert.match(adapter, /^Session file: \.planning\/debug\/login-fails\.md, the one file you may write outside owns/m);
});

test("G115 both debugger overlays state the session-file exception", () => {
  const gsdOverlay = read(path.join(SHIP_DIR, ".agents", "gsd", "overlays", "gsd-debugger.md"));
  const workflowOverlay = read(path.join(SHIP_DIR, ".agents", "workflows", "overlays", "gsd-debugger.md"));
  assert.ok(gsdOverlay.includes("plus the session file named in your runtime adapter, which is the one file outside `owns` you write"));
  assert.ok(workflowOverlay.includes("plus the session file named there, which is the one file outside that scope you write"));
});
