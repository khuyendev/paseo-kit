// Bug-hunt fix G117 (map-codebase): a failed or empty mapper run must not stamp the old codebase map as current.
import assert from "node:assert/strict";
import test from "node:test";
import { NULL, runScript } from "../gsd-flows/host.mjs";
import { makeWorld } from "../gsd-flows/world.mjs";

const FOCUS = { tech: ["STACK", "INTEGRATIONS"], arch: ["ARCHITECTURE", "STRUCTURE"], quality: ["CONVENTIONS", "TESTING"], concerns: ["CONCERNS"] };
const DOCS = Object.values(FOCUS).flat();
const OLD = "1".repeat(40);
const body = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
const oldDoc = (d) => `---\nlast_mapped_commit: ${OLD}\nlast_mapped_at: 2026-10-01T00:00:00.000Z\n---\n# ${d}\n${body(25)}\n`;
const named = (focus) => FOCUS[focus].map((d) => `.planning/codebase/${d}.md`);

// A mapper that rewrites and confirms its docs; `bad` gives a focus the reply it should not have.
const mapper = (w, bad = {}) => (p, o) => {
  if (o.label.startsWith("review-")) return { issues: [] };
  const focus = o.label.replace("mapper-", "");
  if (bad[focus]) return bad[focus];
  for (const d of FOCUS[focus]) w.write(`.planning/codebase/${d}.md`, `# ${d}\n${body(25)}\nrevised\n`);
  return { focus, written: named(focus) };
};

// A map of 7 valid docs stamped at OLD, as left by an earlier run; the run under test starts from it.
async function mapWith(agent) {
  const w = makeWorld({ overlay: { gsd: { commit_policy: { docs: true, code: "per-wave" } } } });
  for (const d of DOCS) w.write(`.planning/codebase/${d}.md`, oldDoc(d));
  const r = await runScript("gsd-map-codebase", { root: w.root, gsd: w.gsd, agent: agent(w) });
  return { r, w };
}

// Nothing after the map step ran: no check, no stamp, no commit, and no doc carries a stamp other than the old one.
function assertStopped(r, w) {
  assert.equal(r.result.status, "failed");
  assert.equal(r.logs.includes("phase Check"), false);
  assert.equal(r.logs.includes("phase Stamp"), false);
  assert.equal(w.events.some((e) => e.startsWith("commit")), false);
  for (const d of DOCS) assert.doesNotMatch(w.read(`.planning/codebase/${d}.md`), new RegExp(`last_mapped_commit: (?!${OLD}\\n)`));
}

test("G117 map-codebase: a mapper with no reply after its retry fails the run and stamps nothing", async () => {
  const { r, w } = await mapWith((w) => mapper(w, { concerns: NULL("no reply within 3600 s") }));
  assert.equal(r.result.reason, "mapper concerns failed: no reply within 3600 s");
  assert.equal(r.calls.filter((c) => c.opts.label === "mapper-concerns").length, 2);
  assertStopped(r, w);
});

test("G117 map-codebase: four silent mappers fail the run instead of stamping the old map", async () => {
  const silent = Object.fromEntries(Object.keys(FOCUS).map((f) => [f, NULL("no reply within 3600 s")]));
  const { r, w } = await mapWith((w) => mapper(w, silent));
  assert.equal(r.calls.length, 8);
  assertStopped(r, w);
});

test("G117 map-codebase: a confirmation that names no docs, or only some of its focus's docs, fails the run", async () => {
  const empty = await mapWith((w) => mapper(w, { quality: { focus: "quality", written: [] } }));
  assert.equal(empty.r.result.reason, "mapper quality failed: its confirmation does not name exactly its docs");
  assertStopped(empty.r, empty.w);
  const partial = await mapWith((w) => mapper(w, { arch: { focus: "arch", written: ["STACK"] } }));
  assert.equal(partial.r.result.reason, "mapper arch failed: its confirmation does not name exactly its docs");
  assertStopped(partial.r, partial.w);
});

test("G117 map-codebase: a non-fatal miss is retried once and the run still maps", async () => {
  const { r, w } = await mapWith((w) => {
    const inner = mapper(w);
    let tries = 0;
    return (p, o) => (o.label === "mapper-tech" && tries++ === 0 ? NULL("no reply within 3600 s") : inner(p, o));
  });
  assert.equal(r.result.status, "mapped");
  assert.equal(r.calls.filter((c) => c.opts.label.startsWith("mapper-")).length, 5);
  assert.match(w.read(".planning/codebase/TESTING.md"), /^---\nlast_mapped_commit: [0-9a-f]{40}\n/);
});

test("G117 map-codebase: a fatal reason (rate limit) still stops at once without a retry", async () => {
  const { r, w } = await mapWith((w) => mapper(w, { tech: NULL("rate limit reached") }));
  assert.equal(r.result.reason, "mapper tech failed: rate limit reached");
  assert.equal(r.calls.filter((c) => c.opts.label === "mapper-tech").length, 1);
  assertStopped(r, w);
});
