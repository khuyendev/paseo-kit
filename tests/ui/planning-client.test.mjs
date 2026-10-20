import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { withAlpha } from "../../plugins/planning-panel/client/color.ts";
import { formatClock, formatRelative, formatShortDate } from "../../plugins/planning-panel/client/format.ts";
import { parseInline, parseMarkdown, resolveTarget } from "../../plugins/planning-panel/client/markdown.ts";
import { detailView, phasesShown, responseMatches, splitView, trailReducer } from "../../plugins/planning-panel/client/nav.ts";
import { chosenWorkspace, hostMemory, rememberSelection, searchProjects, showPicker, toProjects } from "../../plugins/planning-panel/client/projects.ts";
import { register } from "../../plugins/planning-panel/client/register.ts";
import { computeStats } from "../../plugins/planning-panel/client/stats.ts";
import { ancestors, buildTree, filterFiles } from "../../plugins/planning-panel/client/tree.ts";
import { KIT_DIR } from "../helpers/temp.mjs";

const PANEL = path.join(KIT_DIR, "plugins", "planning-panel");

test("PANL-02 planning client registers a sidebar surface, a workspace panel and Open Planning", () => {
  const calls = [];
  let cleaned = 0;
  const off = () => () => (cleaned += 1);
  const done = off;
  let opened = null;
  const host = {
    addSurface: (id) => (calls.push(["surface", id]), done()),
    addSidebarItem: (i) => (calls.push(["sidebar", i.id]), done()),
    addWorkspacePanel: (p) => (calls.push(["panel", p.id, p.context]), done()),
    addCommandCenterItem: (c) => (calls.push(["command", c.title]), c.onSelect({ openPanel: (id) => (opened = id) }), done()),
  };
  const dispose = register(host, () => null, () => null);
  assert.deepEqual(calls, [["surface", "planning"], ["sidebar", "planning"], ["panel", "planning", "workspace"], ["command", "Open Planning"]]);
  assert.equal(opened, "planning");
  dispose();
  assert.equal(cleaned, 4);
});

test("PANL-17 buildTree merges single-child chains, counts and sorts naturally; filter is AND-tokens", () => {
  const rows = buildTree(["a/b/c.md", "a/b/d.md", "e.md"]);
  assert.deepEqual(rows.map((r) => [r.kind, r.name, r.kind === "folder" ? r.count : null]), [["folder", "a/b", 2], ["file", "e.md", null]]);
  const nat = buildTree(["p/10.md", "p/2.md", "p/1.md"], "all").filter((r) => r.kind === "file").map((r) => r.name);
  assert.deepEqual(nat, ["1.md", "2.md", "10.md"]);
  assert.deepEqual(ancestors("phases/01-a/01-01-PLAN.md"), ["phases", "phases/01-a"]);
  const files = [{ path: "phases/03-x/03-01-PLAN.md", title: "Plan the API" }, { path: "ROADMAP.md", title: "Roadmap" }];
  assert.deepEqual(filterFiles(files, "plan 03").map((f) => f.path), ["phases/03-x/03-01-PLAN.md"]);
  assert.deepEqual(filterFiles(files, "03 plan").map((f) => f.path), ["phases/03-x/03-01-PLAN.md"]);
});

test("PANL-18 markdown blocks, inline links and containment of local links", () => {
  const md = "# T\n\npara *it* **b** `code`\n\n```js\nx\n```\n\n- a\n  - [x] b\n    - c\n      - d\n1. one\n\n> q\n\n---\n\n| h1 | h2 |\n| --- | --- |\n| a | b |\n";
  assert.deepEqual(parseMarkdown(md).map((b) => b.kind), ["heading", "paragraph", "code", "list", "quote", "rule", "table"]);
  const list = parseMarkdown("- a\n  - [x] b\n    - c\n      - d\n        - e\n").at(0);
  assert.deepEqual(list.items.map((i) => [i.depth, i.checked]), [[0, null], [1, true], [2, null], [3, null], [3, null]]);
  const table = parseMarkdown("| h1 | h2 |\n| --- | --- |\n| a | b |\n")[0];
  assert.deepEqual([table.hasHeader, table.rows], [true, [["h1", "h2"], ["a", "b"]]]);
  const ctx = { from: "phases/01-a/01-01-PLAN.md", files: new Set(["phases/01-a/01-01-SUMMARY.md", "REQUIREMENTS.md"]), ids: new Set(["01-02", "REQ-01"]) };
  const inl = parseInline("see 01-02 and 09-09 and REQ-01, [s](01-01-SUMMARY.md) [m](missing.md) [x](../../secret.md) [j](javascript:alert(1)) https://e.x/a `.planning/REQUIREMENTS.md`", ctx);
  const links = inl.filter((p) => p.kind === "link").map((p) => [p.text, p.target]);
  assert.deepEqual(links, [
    ["01-02", { type: "id", id: "01-02" }],
    ["REQ-01", { type: "id", id: "REQ-01" }],
    ["s", { type: "file", path: "phases/01-a/01-01-SUMMARY.md" }],
    ["m", null],
    ["x", null],
    ["j", null],
    ["https://e.x/a", { type: "external", url: "https://e.x/a" }],
  ]);
  assert.ok(inl.some((p) => p.kind === "text" && p.text.includes("09-09")), "unknown id stays text");
  assert.deepEqual(inl.find((p) => p.kind === "code").target, { type: "file", path: "REQUIREMENTS.md" });
  assert.equal(resolveTarget("javascript:alert(1)", ctx), null);
  assert.equal(resolveTarget("C:\\x.md", ctx), null);
});

test("PANL-19 computeStats: phases done/open, blocked plans, null percentages unless complete", () => {
  const now = Date.parse("2026-10-20T12:00:00");
  const file = (path, kind, planId, extra = {}) => ({ path, kind, planId, mtimeMs: now - 3600_000, title: path, phase: null, wave: 1, dependsOn: [], requirements: [], status: null, error: null, ...extra });
  const phases = ["COMPLETE", "COMPLETE", "PLANNED", "IN_PROGRESS", "NOT_STARTED"].map((status, i) => ({ id: `0${i + 1}`, dir: `phases/0${i + 1}-x`, name: "x", status }));
  const files = [
    file("phases/03-x/03-01-PLAN.md", "plan", "03-01"),
    file("phases/03-x/03-02-PLAN.md", "plan", "03-02", { dependsOn: ["03-01"], wave: 2 }),
    file("phases/04-x/04-01-PLAN.md", "plan", "04-01"),
    file("phases/04-x/04-01-SUMMARY.md", "summary", "04-01", { status: "complete" }),
    file("old.md", "other", null, { mtimeMs: now - 30 * 86_400_000 }),
  ];
  const s = computeStats({ files, phases, scope: "complete" }, now);
  assert.deepEqual([s.phases.done, s.phases.open, s.phases.pct], [2, 3, 40]);
  assert.deepEqual(s.blocked, [{ planId: "03-02", waitingOn: ["03-01"] }]);
  assert.deepEqual(s.plans, { total: 3, done: 1, pct: 33 });
  assert.equal(s.filesPerDay.length, 14);
  assert.equal(s.filesPerDay.at(-1).count, 4);
  assert.deepEqual(s.summariesByStatus, [{ status: "complete", count: 1 }]);
  assert.ok(!("tasks" in s));
  const t = computeStats({ files, phases, scope: "truncated" }, now);
  assert.deepEqual([t.phases.pct, t.plans.pct], [null, null]);
});

test("PANL-19 an unparseable SUMMARY is not done and withholds the plan percentage (CR-PNL-06)", () => {
  const now = Date.parse("2026-10-20T12:00:00");
  const file = (path, kind, planId, extra = {}) => ({ path, kind, planId, mtimeMs: now, title: path, phase: null, wave: 1, dependsOn: [], requirements: [], status: null, error: null, ...extra });
  const files = [
    file("phases/01-x/01-01-PLAN.md", "plan", "01-01"),
    file("phases/01-x/01-01-SUMMARY.md", "summary", "01-01", { error: { message: "unterminated flow", line: 2 } }),
    file("phases/01-x/01-02-PLAN.md", "plan", "01-02", { dependsOn: ["01-01"] }),
    file("phases/01-x/superseded/01-02-SUMMARY.md", "summary", null, { status: "complete" }),
  ];
  const s = computeStats({ files, phases: [{ id: "01", dir: "phases/01-x", name: "x", status: "EXECUTED" }], scope: "complete" }, now);
  assert.deepEqual(s.plans, { total: 2, done: 0, pct: null });
  assert.deepEqual(s.summariesByStatus, [{ status: "(unparsed)", count: 1 }]);
  assert.deepEqual(s.blocked, [{ planId: "01-02", waitingOn: ["01-01"] }]);
});

test("PANL-20 a checkout and a worktree make one project with the checkout as default; selection survives remounts", () => {
  const ws = (id, kind, extra = {}) => ({ id, projectId: "p1", projectDisplayName: "Proj", projectRootPath: "C:/src/proj", name: id, workspaceKind: kind, ...extra });
  const projects = toProjects([ws("wt", "worktree"), ws("main", "local_checkout"), ws("gone", "checkout", { archivingAt: "x" })]);
  assert.equal(projects.length, 1);
  assert.deepEqual(projects[0].workspaces.map((w) => w.id), ["main", "wt"]);
  assert.equal(chosenWorkspace(projects[0], null).id, "main");
  assert.equal(showPicker(projects), false);
  rememberSelection("host-a", "p1", "wt");
  assert.equal(chosenWorkspace(projects[0], hostMemory("host-a").workspaceId).id, "wt", "remount reads the host memory");
  assert.equal(hostMemory("host-b").workspaceId, null);
  for (let i = 0; i < 7; i += 1) rememberSelection("host-a", `p${i}`, "w");
  assert.equal(hostMemory("host-a").recent.length, 5);
  const two = toProjects([ws("a", "local_checkout"), { ...ws("b", "local_checkout"), projectId: "p2", projectDisplayName: "Other", projectRootPath: "D:/elsewhere/x" }]);
  assert.equal(showPicker(two), true);
  assert.deepEqual(searchProjects(two, "elsewhere x", []).map((p) => p.id), ["p2"]);
});

test("PANL-21 trail: select resets, link pushes without duplicate, back pops, close clears; split only when wide", () => {
  const A = { kind: "plan", id: "01-01" };
  const B = { kind: "file", path: "x.md" };
  let t = trailReducer([], { type: "select", item: A });
  t = trailReducer(t, { type: "link", item: B });
  t = trailReducer(t, { type: "link", item: B });
  assert.deepEqual(t, [A, B]);
  assert.deepEqual(trailReducer(t, { type: "back" }), [A]);
  assert.deepEqual(trailReducer(t, { type: "close" }), []);
  assert.deepEqual(trailReducer(t, { type: "select", item: B }), [B]);
  assert.equal(splitView(false, 960), true);
  assert.equal(splitView(false, 959), false);
  assert.equal(splitView(true, 2000), false);
});

test("PANL-16 a delayed or other-worktree response never shows its body", () => {
  const want = { workspaceId: "main", planId: "01-02", path: "phases/01-a/01-02-PLAN.md" };
  assert.equal(responseMatches(want, { ok: true, workspaceId: "main", planId: "01-01", path: "phases/01-a/01-01-PLAN.md" }), false, "plan A while B loads");
  assert.equal(responseMatches(want, { ok: true, workspaceId: "worktree", planId: "01-02", path: "phases/01-a/01-02-PLAN.md" }), false, "same id, other worktree");
  assert.equal(responseMatches(want, { ok: true, workspaceId: "main", planId: "01-02", path: "phases/01-a/01-02-PLAN.md" }), true);
  assert.equal(responseMatches({ workspaceId: "main", path: "a.md" }, { ok: true, workspaceId: "main", path: "b.md" }), false);
  assert.equal(responseMatches(want, undefined), false);
});

test("PANL-22 withAlpha", () => {
  assert.equal(withAlpha("#fff", 0.5), "rgba(255, 255, 255, 0.500)");
  assert.equal(withAlpha("#11223380", 1), "rgba(17, 34, 51, 0.502)");
  assert.equal(withAlpha("red", 0.5), "red");
  assert.equal(withAlpha("rgb(1,2,3)", 0.5), "rgb(1,2,3)");
});

test("PANL-23 planning format helpers", () => {
  const now = Date.parse("2026-10-20T12:00:00Z");
  assert.equal(formatRelative(now - 59_000, now), "just now");
  assert.equal(formatRelative(now - 60_000, now), "1m ago");
  assert.equal(formatRelative(now - 3 * 3600_000, now), "3h ago");
  assert.equal(formatRelative(now - 13 * 86_400_000, now), "13d ago");
  assert.doesNotMatch(formatRelative(now - 14 * 86_400_000, now), /ago/);
  const d = formatShortDate("2026-01-05");
  assert.match(d, /5/);
  assert.doesNotMatch(d, /4/, "date-only strings are local dates");
  assert.match(formatClock(now), /^\d\d:\d\d:\d\d$/);
});

test("PANL-16 detail panes: failure, unreachable with no data, stale body after a failed refetch, loading (CR-PNL-08)", () => {
  const ok = { ok: true };
  assert.deepEqual(detailView({ data: undefined, isError: false, isPlaceholderData: false }, false), { state: "loading" });
  assert.deepEqual(detailView({ data: undefined, isError: true, isPlaceholderData: false }, false), { state: "unreachable" }, "an initial rejection never loads forever");
  assert.deepEqual(detailView({ data: ok, isError: true, isPlaceholderData: false }, true), { state: "ready", stale: true }, "a refetch rejection marks the shown body");
  assert.deepEqual(detailView({ data: ok, isError: false, isPlaceholderData: false }, true), { state: "ready", stale: false }, "reconnected");
  assert.deepEqual(detailView({ data: { ok: false }, isError: false, isPlaceholderData: false }, false), { state: "failure" });
  assert.deepEqual(detailView({ data: ok, isError: true, isPlaceholderData: true }, true), { state: "unreachable" }, "another item's cached body is never shown");
});

test("PANL-17 open details poll and Refresh rereads them (CR-PNL-08)", () => {
  const data = fs.readFileSync(path.join(PANEL, "client", "data.ts"), "utf8");
  for (const hook of ["usePlan", "useFile"]) assert.match(data, new RegExp(`export function ${hook}\\([^)]*\\) \\{\\n[^\\n]*\\n[^\\n]*refetchInterval: LIST_POLL_MS`), hook);
  const panel = fs.readFileSync(path.join(PANEL, "client", "panel.tsx"), "utf8");
  assert.match(panel, /\["planning-plan", "planning-file"\]\.map\(\(k\) => queryClient\.refetchQueries/);
});

test("PANL-21 a board card shows its phase's plans, never sends a folder to the file reader (CR-PNL-09)", () => {
  const phases = [{ id: "1" }, { id: "2" }];
  assert.deepEqual(phasesShown(phases, "2"), [{ id: "2" }]);
  assert.deepEqual(phasesShown(phases, null), phases);
  assert.deepEqual(phasesShown(phases, "9"), phases, "a vanished phase shows all");
  const views = fs.readFileSync(path.join(PANEL, "client", "views.tsx"), "utf8");
  assert.doesNotMatch(views, /kind: "file", path: `?\$?\{?phase\.dir/);
  assert.match(views, /onPress=\{\(\) => onShowPhase\(phase\.id\)\}/);
});
