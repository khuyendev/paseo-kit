// Kit feedback 101 F1: the existing test files the verify commands of an outline run, each with the plans of the phase that own it.
// A test no plan owns was written by an earlier phase: when this phase changes the behaviour it asserts, no plan may edit it and a
// planner finds the contradiction late (REVISION_CONFLICT). `outline check` holds such a test as an error: the outline assigns it
// (owns) to the plan that changes that behaviour, or drops it from the command. The skeleton lanes get the list (F2).
import fs from "node:fs";
import path from "node:path";
import { matchesGlob } from "../adapter/contract.mjs";
import { isInside } from "../lib/paths.mjs";
import { readIf } from "./common.mjs";
import { covers, filesUnder } from "./adapter-hooks.mjs";

// A path argument of a command (a file or a directory); `:<line>` suffixes are cut.
const PATH_TOKEN = /^(?!-)[\w@.-]+(?:\/[\w@.-]+)*$/;
// The stack test paths and test declarations of the check-weakening invariant (kit feedback 87 C1), read from the workflows lib
// when it is installed; without it only adapter.checks.paths can name test files.
let stacks;
async function testRules(g) {
  if (stacks === undefined) stacks = await import("../../workflows/lib/flow-checks.mjs").then((m) => m.STACKS, () => null);
  return { paths: g.cfg.adapter.checks?.paths ?? null, stacks: stacks ?? [] };
}
// A file is a test when the project's check paths or its stack's test paths match it; a file found under a directory argument
// (`text` given) also needs a test declaration of its stack, so helpers and fixtures under test/ do not count.
function isTest(rel, rules, text) {
  const stack = rules.stacks.find((s) => s.ext.includes(path.posix.extname(rel).toLowerCase())) ?? null;
  if (!(rules.paths ?? stack?.paths ?? []).some((glob) => matchesGlob(rel, glob))) return false;
  return text === undefined || !stack || stack.test_decl.some((src) => new RegExp(src, "m").test(text));
}

/** {tests: [{file, plans (running it), owners}], problems: [message]} for the manifest plans and their owned paths (id -> paths). */
export async function inheritedTests(g, plans, ownedOf) {
  const rules = await testRules(g);
  const runs = new Map();
  for (const p of plans) {
    const id = String(p.id);
    for (const v of Array.isArray(p.verify) ? p.verify : []) {
      for (const raw of String(v).split(/\s+/)) {
        const token = raw.replace(/^["']|["']$/g, "").replace(/:\d+(?:[:-]\d+)?$/, "").replace(/^\.\//, "").replace(/\/+$/, "");
        if (!PATH_TOKEN.test(token) || !/[/.]/.test(token)) continue;
        const abs = path.resolve(g.codeRoot, token);
        if (!isInside(abs, g.codeRoot)) continue;
        let stat;
        try { stat = fs.statSync(abs); } catch { continue; }
        const files = stat.isDirectory() ? filesUnder(g.codeRoot, token).filter((f) => isTest(f, rules, readIf(path.join(g.codeRoot, f)) ?? "")) : isTest(token, rules) ? [token] : [];
        for (const f of files) {
          const e = runs.get(f) ?? new Map();
          e.set(id, token);
          runs.set(f, e);
        }
      }
    }
  }
  const tests = [];
  const unowned = new Map();
  for (const file of [...runs.keys()].sort()) {
    const owners = [...ownedOf].filter(([, paths]) => paths.some((o) => o === file || covers(o, file))).map(([id]) => id);
    tests.push({ file, plans: [...runs.get(file).keys()].sort(), owners });
    if (!owners.length) for (const [id, token] of runs.get(file)) unowned.set(`${id}\0${token}`, [...(unowned.get(`${id}\0${token}`) ?? []), file]);
  }
  const problems = [...unowned].map(([k, files]) => {
    const [id, token] = k.split("\0");
    const what = files.length === 1 && files[0] === token ? token : `${token} (${files.length} test file${files.length === 1 ? "" : "s"}: ${files.slice(0, 5).join(", ")}${files.length > 5 ? ", ..." : ""})`;
    return `${id}: verify runs ${what}, which no plan of this phase owns (an inherited test): assign it (owns) to the plan that changes the behaviour it asserts, or drop it from the command`;
  });
  return { tests, problems };
}
