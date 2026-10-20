import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { parseFrontmatter } from "../../plugins/planning-panel/server/frontmatter.ts";
import { PlanningService } from "../../plugins/planning-panel/server/service.ts";
import { KIT_DIR, SHIP_DIR } from "../helpers/temp.mjs";
import { fakeWorkspaces, makeWorkspace, planText, summaryText, write } from "./planning-fixtures.mjs";

const KIT_YAML = path.join(SHIP_DIR, ".agents", "harness", "gsd", "yaml.mjs");
const FIXTURE_DIR = path.join(KIT_DIR, "tests", "gsd-core", "fixtures", "frontmatter");

// GSDC-05 shapes: PLAN with nested must_haves, SUMMARY with key-files and a block scalar, VERIFICATION with gaps[],
// CONTEXT, BOM/CRLF, comments, multi-line flow, and malformed cases.
const CASES = {
  plan: planText().split("<objective>")[0],
  summary: summaryText("complete", ["a.ts", "b c.ts"]),
  verification: "---\nphase: 02-api\nstatus: gaps_found\nscore: 3/5\ngaps:\n  - truth: \"Users can log in\"\n    status: failed\n    reason: \"no route\"\n    artifacts:\n      - path: src/login.ts\n        issue: missing\n    missing:\n      - \"POST /login\"\n---\n",
  context: "---\nphase: 01-core\ngathered: 2026-10-20\nstatus: Ready for planning\n---\n# Context\n",
  bomCrlf: "﻿---\r\nphase: 01\r\nwave: 2 # trailing comment\r\nlist: [a,\r\n  'b c', \"d#e\"]\r\nfolded: >\r\n  x\r\n  y\r\n\r\n  z\r\nkeep: |+\r\n  k\r\n\r\n---\r\n",
  scalars: "---\nt: true\nf: False\nn: null\ntilde: ~\ni: -12\nfl: 1.25\ne: 1e3\nq1: 'it''s'\nq2: \"tab\\there\"\nplain: hello world\nempty:\n---\n",
  nestedSeq: "---\nrequires:\n  - phase: 01-core\n    provides: [api, db]\n  - phase: 02\n    provides: []\n---\n",
  badIndent: "---\na: 1\n   b: 2\n---\n",
  unclosedFlow: "---\na: [1, 2\nb: 3\n---\n",
  unclosedQuote: "---\na: \"x\n---\n",
  duplicate: "---\na: 1\na: 2\n---\n",
  notClosed: "---\na: 1\n",
};

test("PANL-14 parser: nested GSD shapes, BOM/CRLF, comments, flow, block scalars; errors carry their line", () => {
  const plan = parseFrontmatter(CASES.plan);
  assert.deepEqual(plan.data.must_haves.artifacts, [{ path: "src/a.ts", provides: "the thing" }]);
  assert.deepEqual(plan.data.must_haves.truths, ["User sees the thing"]);
  const s = parseFrontmatter(CASES.summary);
  assert.deepEqual(s.data["key-files"], { created: ["a.ts", "b c.ts"], modified: [] });
  assert.equal(s.data.notes, "multi\nline\n");
  const v = parseFrontmatter(CASES.verification);
  assert.deepEqual(v.data.gaps[0].artifacts, [{ path: "src/login.ts", issue: "missing" }]);
  const b = parseFrontmatter(CASES.bomCrlf);
  assert.deepEqual([b.data.wave, b.data.list, b.data.folded, b.data.keep], [2, ["a", "b c", "d#e"], "x y\nz\n", "k\n\n"]);
  const sc = parseFrontmatter(CASES.scalars);
  assert.deepEqual(sc.data, { t: true, f: false, n: null, tilde: null, i: -12, fl: 1.25, e: 1000, q1: "it's", q2: "tab\there", plain: "hello world", empty: null });
  for (const [name, line] of [["badIndent", 3], ["unclosedFlow", 2], ["unclosedQuote", 2], ["duplicate", 3], ["notClosed", 1]]) {
    const r = parseFrontmatter(CASES[name]);
    assert.equal(r.line, line, name);
    assert.match(r.error, new RegExp(`^line ${line}: `), name);
  }
  assert.deepEqual(parseFrontmatter("# no frontmatter\n"), { data: null, body: "# no frontmatter\n", endLine: 0 });
});

test("PANL-14 the port gives the same JSON as the kit parser of ph gsd (GSDC-05)", async (t) => {
  if (!fs.existsSync(KIT_YAML)) return t.skip("ship/.agents/harness/gsd/yaml.mjs not present");
  const { frontmatter } = await import(pathToFileURL(KIT_YAML).href);
  const cases = { ...CASES };
  if (fs.existsSync(FIXTURE_DIR)) for (const f of fs.readdirSync(FIXTURE_DIR).filter((n) => n.endsWith(".md"))) cases[`fixture ${f}`] = fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8");
  for (const [name, text] of Object.entries(cases)) {
    const kit = frontmatter(text);
    const port = parseFrontmatter(text);
    if (kit.error) {
      assert.ok("error" in port, `${name}: kit errors (${kit.error}) but the port parsed`);
      assert.equal(port.line, kit.line, `${name}: error line`);
    } else {
      assert.ok(!("error" in port), `${name}: port error ${port.error}`);
      assert.deepEqual(port.data ?? {}, kit.fm, name);
    }
  }
});

test("PANL-15 board statuses equal ph gsd roadmap analyze on one phase per ladder state", async (t) => {
  const gsdDir = path.join(SHIP_DIR, ".agents", "harness", "gsd");
  if (!fs.existsSync(path.join(gsdDir, "phases.mjs"))) return t.skip("gsd-core modules not present");
  const { analyze } = await import(pathToFileURL(path.join(gsdDir, "phases.mjs")).href);
  const { loadKitConfig } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents", "harness", "config.mjs")).href);
  const { dir, root } = makeWorkspace();
  const names = ["empty", "planned", "partial", "executed", "review"];
  write(root, "ROADMAP.md", `# Roadmap\n\n${names.map((n, i) => `### Phase ${i + 1}: ${n}\n**Goal**: g\n**Depends on**: None\n**Requirements**: None\n**Success Criteria**:\n1. ok\n`).join("\n")}`);
  const pdir = (i) => `phases/0${i + 1}-${names[i]}`;
  write(root, `${pdir(0)}/01-CONTEXT.md`, "# c\n");
  write(root, `${pdir(1)}/02-01-PLAN.md`, planText({ phase: "02-planned" }));
  for (const i of [2, 3, 4]) for (const p of ["01", "02"]) write(root, `${pdir(i)}/0${i + 1}-${p}-PLAN.md`, planText({ phase: pdir(i), plan: p }));
  write(root, `${pdir(2)}/03-01-SUMMARY.md`, summaryText("complete"));
  for (const i of [3, 4]) for (const p of ["01", "02"]) write(root, `${pdir(i)}/0${i + 1}-${p}-SUMMARY.md`, summaryText("complete"));
  write(root, `${pdir(4)}/05-VERIFICATION.md`, "---\nphase: 05-review\nstatus: gaps_found\n---\n# V\n");
  const expected = analyze({ codeRoot: dir, cfg: loadKitConfig() }).phases.map((p) => [p.directory.replace(/\\/g, "/").replace(/^\.planning\//, ""), p.status]);
  const board = await new PlanningService().board(fakeWorkspaces({ w: dir }), { workspaceId: "w" });
  assert.equal(board.ok, true, board.message);
  assert.equal(board.statusError, null);
  const got = board.columns.flatMap((c) => c.phases.map((p) => [p.dir, p.status])).sort();
  assert.deepEqual(got, expected.sort());
  assert.ok(new Set(got.map((g) => g[1])).size >= 4, JSON.stringify(got));
});
