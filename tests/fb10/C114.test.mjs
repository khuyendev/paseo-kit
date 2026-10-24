// Kit feedback 114 F1-F3 and 116 F1 F2 F4 (C114): a qualified span is not another symbol's shape, and a produced
// signature matches an equivalent declaration (Dart field formals, multi-name fields, bodies, parameter names).
import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { contractDrift, producedCheck } from "../../ship/.agents/harness/gsd/contracts.mjs";
import { makeTempProject, SHIP_DIR } from "../helpers/temp.mjs";

const { main } = await import(pathToFileURL(path.join(SHIP_DIR, ".agents/workflows/lib/gsd-flow.mjs")).href);
const PD = ".planning/phases/01-core";
const NODE = process.execPath;

const prod = (symbol, kind, file, signature) => ({ symbol, kind, file, signature });
const plan = (id, produces) => ({ id, owns: ["Path:lib/"], requirements: ["R"], consumes: [], produces });
const manifest = (plans) => JSON.stringify({ phase: "05", plans });
const driftOf = (before, after, plans) => contractDrift(
  { outline: before, manifest: manifest(plans) },
  { outline: after, manifest: manifest(plans) },
);

const DEMAND = prod("TimelineDemand.setVisible", "method", "lib/demand.dart", "TimelineDemand.setVisible(String agentId, bool visible)");
const OWNER = prod("TimelineOwner.setVisible", "method", "lib/owner.dart", "TimelineOwner.setVisible(bool visible)");

test("C114 114 F1 a span qualified by another type does not shape the symbol; its own qualifier and a bare segment still do", () => {
  const plans = [plan("05-01", [DEMAND])];
  const before = "writes `TimelineDemand.setVisible(String agentId, bool visible)`.";
  const other = driftOf(before, `${before} also \`TimelineOwner.setVisible(bool)\`.`, plans);
  assert.deepEqual(other.drift, [], JSON.stringify(other));
  const own = driftOf(before, `${before} now \`TimelineDemand.setVisible(String agentId, int visible)\`.`, plans);
  assert.deepEqual(own.drift.map((d) => d.symbol), ["TimelineDemand.setVisible"]);
  const bare = driftOf(before, `${before} now \`setVisible(int visible)\`.`, plans);
  assert.deepEqual(bare.drift.map((d) => d.symbol), ["TimelineDemand.setVisible"]);
  // `::` is the same qualifier class as `.` (lastSegment).
  const cpp = prod("DaemonClient::pause", "method", "lib/a.cpp", "void pause(int ms)");
  const colon = driftOf("was `DaemonClient::pause(int ms)`.", "now `OtherClient::pause(int ms)`.", [plan("05-01", [cpp])]);
  assert.deepEqual(colon.drift, [], JSON.stringify(colon));
});

test("C114 114 F2 a span that is exactly another produced symbol is not drift for this one", () => {
  const helper = prod("Helper.format", "method", "lib/a.dart", "void format()");
  const bare = prod("format", "method", "lib/b.dart", "String format(String pattern)");
  const before = "writes `Helper.format()` and `String format(String pattern)`.";
  const after = `${before} also \`format(String pattern)\`.`;
  const d = driftOf(before, after, [plan("05-01", [helper]), plan("05-02", [bare])]);
  assert.deepEqual(d.drift, [], JSON.stringify(d));
  // The reported pair: TimelineOwner.setVisible(bool) is the owner's shape, not the demand's.
  const pair = driftOf(
    "writes `TimelineDemand.setVisible(String agentId, bool visible)`.",
    "writes `TimelineOwner.setVisible(bool)`.",
    [plan("05-01", [DEMAND, OWNER])],
  );
  assert.deepEqual(pair.drift, [], JSON.stringify(pair));
});

test("C114 114 F3 a real drift names the other produced symbol the span matches", () => {
  const save = prod("Repo.save", "method", "lib/a.dart", "void save(String path)");
  const cache = prod("Cache", "class", "lib/b.dart", "class Cache");
  const d = driftOf(
    "writes `void save(String path)`.",
    "writes `Repo.save(Cache store)`.",
    [plan("05-01", [save, cache])],
  );
  assert.deepEqual(d.drift.map((x) => x.symbol), ["Repo.save"]);
  assert.match(d.errors[0], /contract drift: the outline now shapes Repo\.save as `Repo\.save\(Cache store\)`/);
  assert.match(d.errors[0], /The span matches Cache\./);
  assert.equal(d.drift[0].matched, undefined, "the drift object stays plan, symbol, signature, spans");
});

function codeProject(files, produces) {
  return makeTempProject({
    files: {
      [`${PD}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans: [plan("01-01", produces)] }),
      ...files,
    },
  });
}
const notesOf = (p) => producedCheck(p.root, PD, ["01-01"])[0];

const EQUIV = [
  prod("TimelineState.hasOlder", "field", "lib/models.dart", "final bool hasOlder;"),
  prod("TimelineReplicaStore", "class", "lib/store.dart", "TimelineReplicaStore(PaseoDatabase database)"),
  prod("TimerFrameCommitScheduler", "class", "lib/sched.dart", "TimerFrameCommitScheduler({Duration ceiling = agentStreamReducerFlushDelay})"),
  prod("LegacyTimelineDelivery", "class", "lib/delivery.dart", "LegacyTimelineDelivery(HostSessionLease lease)"),
  prod("TimelineDemand.visibilityChanges", "getter", "lib/delivery.dart", "Stream<({String agentId, bool visible})> get visibilityChanges;"),
  prod("TimelineDemand.subscribed", "getter", "lib/delivery.dart", "Set<String> get subscribed;"),
  prod("TimelineDemand.changes", "getter", "lib/delivery.dart", "Stream<Set<String>> get changes;"),
  prod("TimelineOwner.setVisible", "method", "lib/owner.dart", "void setVisible(bool visible)"),
  prod("Foo", "class", "lib/foo.dart", "Foo(PaseoDatabase database)"),
];

test("C114 116 F1 F2 equivalent declarations hold the signature: no note", () => {
  const p = codeProject({
    "lib/models.dart": "final class TimelineState {\n  final bool hasOlder, turnActive;\n}\n",
    "lib/store.dart": "class TimelineReplicaStore {\n  TimelineReplicaStore(this.database);\n  final PaseoDatabase database;\n}\n",
    "lib/sched.dart": "final class TimerFrameCommitScheduler {\n  TimerFrameCommitScheduler({this.ceiling = agentStreamReducerFlushDelay});\n  final Duration ceiling;\n}\n",
    "lib/delivery.dart": [
      "final class LegacyTimelineDelivery {",
      "  LegacyTimelineDelivery(this.lease);",
      "  final HostSessionLease lease;",
      "}",
      "final class TimelineDemand {",
      "  Set<String> get subscribed => Set.unmodifiable({});",
      "  Stream<Set<String>> get changes { return _changes.stream; }",
      "  Stream<({String agentId, bool visible})> get visibilityChanges => _visibility.stream;",
      "}",
      "",
    ].join("\n"),
    "lib/owner.dart": "class TimelineOwner {\n  void setVisible(bool value) { if (!_disposed) visible = value; }\n}\n",
    "lib/foo.dart": "class Foo {\n  Foo(super.database);\n}\n",
  }, EQUIV);
  const r = notesOf(p);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.notes, [], JSON.stringify(r.notes));
  // A different default expression is still optional: not a finding.
  const loose = codeProject({
    "lib/sched.dart": "class TimerFrameCommitScheduler {\n  TimerFrameCommitScheduler({Duration ceiling = otherDelay});\n}\n",
  }, [EQUIV[2]]);
  assert.deepEqual(notesOf(loose).notes, [], JSON.stringify(notesOf(loose).notes));
});

test("C114 116 F2 only a name, kind, type, arity or optionality mismatch is a note, and an unreadable signature still notes", () => {
  const bad = [
    prod("Widget.setVisible", "method", "lib/bad.dart", "void setVisible(bool visible)"),
    prod("Widget.setVisible2", "method", "lib/bad.dart", "void setVisible2(bool visible)"),
    prod("Widget.named", "method", "lib/bad.dart", "void named(bool visible)"),
    prod("State.hasOlder", "field", "lib/bad.dart", "final bool hasOlder;"),
    prod("Widget.optional", "method", "lib/bad.dart", "void optional(bool visible)"),
    prod("Foo", "class", "lib/bad.dart", "Foo(PaseoDatabase database)"),
    prod("mystery", "method", "lib/bad.dart", "??? mystery ???"),
  ];
  const p = codeProject({
    "lib/bad.dart": [
      "void setVisible(int value) {}",
      "void setVisible2(bool value, int extra) {}",
      "void named({bool value}) {}",
      "bool get hasOlder => true;",
      "void optional([bool value]) {}",
      "Foo(this.other);",
      "mystery();",
      "",
    ].join("\n"),
  }, bad);
  const notes = notesOf(p).notes;
  const noted = (symbol) => notes.some((n) => n.startsWith(`${symbol}:`));
  assert.equal(noted("Widget.setVisible"), true, JSON.stringify(notes));
  assert.equal(noted("Widget.setVisible2"), true, JSON.stringify(notes));
  assert.equal(noted("Widget.named"), true, JSON.stringify(notes));
  assert.equal(noted("State.hasOlder"), true, JSON.stringify(notes));
  assert.equal(noted("Widget.optional"), true, JSON.stringify(notes));
  assert.equal(noted("Foo"), true, "a field formal matches a typed parameter of that name only");
  assert.equal(noted("mystery"), true, "unreadable: the note stays");
  assert.equal(notes.length, bad.length, JSON.stringify(notes));
});

test("C114 116 F4 the gate note shows < and > unescaped, and a held signature is not noted", async () => {
  const sig = "Set<String> get subscribed;";
  const overlay = { adapter: { commands: { build: [NODE, "-e", "process.exit(0)"], test: [NODE, "-e", "process.exit(0)"], build_timeout_s: 30, test_timeout_s: 30, gates: [], verify: {} } } };
  const files = (body) => ({
    [`${PD}/01-PLAN-OUTLINE.manifest.json`]: JSON.stringify({ phase: "01", plans: [plan("01-01", [prod("TimelineDemand.subscribed", "getter", "lib/a.dart", sig)])] }),
    "lib/a.dart": body,
  });
  const held = codeProject(files("Set<String> get subscribed => Set.unmodifiable({});\n"), [prod("TimelineDemand.subscribed", "getter", "lib/a.dart", sig)]);
  assert.deepEqual(notesOf(held).notes, []);
  const p = makeTempProject({ files: files("Set<int> get subscribed => const {};\n"), overlay });
  let line = "";
  const code = await main(["gate", PD], { root: p.root, input: JSON.stringify({ waveId: "w1", plans: [{ id: "01-01", owns: ["Path:lib/"], verify: [] }] }), out: (l) => { line = l; } });
  const json = JSON.parse(line);
  assert.equal(code, 0, JSON.stringify(json));
  const note = (json.notes ?? []).find((n) => n.includes("subscribed"));
  assert.ok(note, JSON.stringify(json.notes));
  assert.match(note, /Set<String> get subscribed;/);
  assert.equal(note.includes("&lt;"), false);
  assert.equal(note.includes("&gt;"), false);
});

test("C114 116 keeps the JSON key-path note of item 103", () => {
  const file = "lib/i18n/strings.json";
  const signature = "flutter.projectIcon { invalidUrl, noSupportedIcon }";
  const p = codeProject({
    [file]: JSON.stringify({ flutter: { projectIcon: { invalidUrl: "bad" } } }),
  }, [prod("t.flutter.projectIcon", "catalog", file, signature)]);
  assert.deepEqual(notesOf(p).notes, [`t.flutter.projectIcon: ${file} missing key path flutter.projectIcon.noSupportedIcon`]);
  const held = codeProject({
    [file]: JSON.stringify({ flutter: { projectIcon: { invalidUrl: "bad", noSupportedIcon: "none" } } }),
  }, [prod("t.flutter.projectIcon", "catalog", file, signature)]);
  assert.deepEqual(notesOf(held).notes, []);
});
