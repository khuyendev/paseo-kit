// OFFC-25 Hermes gate: the office client bundle, built exactly as the Paseo 0.12.0 daemon builds it, must compile under the
// Hermes of the phone app (react-native 0.81.5), and every screen and sidebar item it registers must render under the
// host's module map. Generic: it renders whatever index.client.tsx registers, with the params its sidebar items open.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { KIT_DIR } from "../helpers/temp.mjs";

const PLUGIN_DIR = path.join(KIT_DIR, "plugins", "office");
const SKIP = fs.existsSync(path.join(PLUGIN_DIR, "node_modules"))
  ? false
  : "plugins/office/node_modules is missing: run npm install --ignore-scripts in plugins/office (the OFFC-25 Hermes gate needs esbuild, hermesc and react-native-web)";
const host = SKIP ? null : await import("./office-hermes-host.mjs");
const HERMES = "Hermes (react-native 0.81.5, the Paseo phone app) rejects class syntax in plugin client code; use a factory function";

// Client sources: what the daemon may put in the client bundle (server code runs in Node and is exempt).
function clientSources() {
  const files = [path.join(PLUGIN_DIR, "index.client.tsx")];
  for (const dir of ["client", "shared"]) {
    for (const f of fs.readdirSync(path.join(PLUGIN_DIR, dir), { recursive: true })) {
      const file = path.join(PLUGIN_DIR, dir, String(f));
      if (/\.(c|m)?[jt]sx?$/.test(file) && fs.statSync(file).isFile()) files.push(file);
    }
  }
  return files;
}

// A class declaration or expression, `class X extends Y` included; type-only `extends` (interfaces, generics) is erased by
// esbuild and never reaches Hermes. Comments are blanked first so prose may say "class".
const CLASS_RE = /\bclass(?:\s+[A-Za-z_$][\w$]*)?\s*(?:<[^>{]*>\s*)?(?:extends\b|\{)/;

test("OFFC-25 source rule: no class syntax in plugins/office client code (index.client.tsx, client/, shared/)", () => {
  const offenders = [];
  for (const file of clientSources()) {
    const code = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).replace(/(^|[^:])\/\/.*$/gm, "$1");
    code.split("\n").forEach((line, i) => {
      if (CLASS_RE.test(line)) offenders.push(`${path.relative(KIT_DIR, file)}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `${HERMES}:\n${offenders.join("\n")}`);
});

test("OFFC-25 the daemon-built client bundle compiles under the Hermes of react-native 0.81.5 with zero errors", { skip: SKIP, timeout: 120_000 }, async () => {
  const bundle = await host.compileClient();
  const errors = host.hermesErrors(bundle).map((e) => `bundle ${e.line}:${e.col} ${e.message}: ${host.bundleLine(bundle, e.line)}`);
  assert.deepEqual(errors, [], `hermesc rejected the office client bundle (${HERMES}):\n${errors.join("\n")}`);
});

test("OFFC-25 every registered screen and sidebar item renders under the host module map and Hermes", { skip: SKIP, timeout: 120_000 }, async () => {
  const bundle = await host.compileClient();
  const runtime = await host.createHost();
  const { screens, sidebarItems, cleanup } = runtime.contribute(host.emulateHermes(bundle, host.hermesErrors(bundle)));
  assert.ok(screens.length > 0 && sidebarItems.length > 0, "index.client.tsx registers at least one screen and one sidebar item");
  const failures = [];
  const check = (what, result) => {
    if (result.failure) failures.push(`${what}: ${result.failure}`);
    if (runtime.missing.size) failures.push(`${what}: react-native names a host does not export: ${[...runtime.missing].join(", ")}`);
    runtime.missing.clear();
  };

  // Sidebar items: render, then press every pressable to learn which screens and params they open.
  const opened = [];
  for (const item of sidebarItems) {
    const props = { currentScreen: null, openScreen: (input) => opened.push(input), openPopover() {} };
    const result = await runtime.render(item.Component, props);
    check(`${item.kind} ${item.id}`, result);
    for (const node of result.renderer.root.findAll((n) => typeof n.type !== "string" && typeof n.props.onPress === "function")) {
      await runtime.act(async () => node.props.onPress());
    }
    await runtime.act(async () => result.renderer.unmount());
  }

  // Screens: without params, and with every params set a sidebar item opens.
  for (const screen of screens) {
    const paramSets = [{}, ...opened.filter((o) => o.screenId === screen.id).map((o) => o.params ?? {})];
    const unique = [...new Map(paramSets.map((p) => [JSON.stringify(p), p])).values()];
    for (const params of unique) {
      const result = await runtime.render(screen.Component, { params });
      check(`screen ${screen.id} ${JSON.stringify(params)}`, result);
      await runtime.act(async () => result.renderer.unmount());
    }
  }
  for (const o of opened) assert.ok(screens.some((s) => s.id === o.screenId), `a sidebar item opens the unregistered screen ${o.screenId}`);
  cleanup();
  runtime.disposeServer?.();
  assert.deepEqual(failures, []);
});
