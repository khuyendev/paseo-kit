// Paseo 0.12.0 host for the office plugin's client bundle, as the phone app runs it (OFFC-25).
// Build: the daemon's compileTarget("client") (@getpaseo/server dist/server/server/plugins/compiler.js in the desktop app's
// app.asar): same esbuild version, options, externals, Hermes interop rewrite and CommonJS wrapper. Its runtime-boundary
// plugin is left out: it only rejects imports, it never changes the output.
// Engine: the app is Expo 54 / react-native 0.81.5 on Hermes 0.12, whose compiler is react-native's sdks/hermesc.
// Module map: packages/app/src/plugins/evaluate.ts @ v0.12.0 (globalThis.eval(bundle)(require)); react-native is the full
// module, react-native-web on desktop and react-native 0.81.5 on the phone, so here it is react-native-web restricted to
// the names BOTH export. Every dependency is loaded lazily: the test file skips when plugins/office/node_modules is missing.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { fakeServer } from "./fake-paseo.mjs";

export const PLUGIN_DIR = path.join(KIT_DIR, "plugins", "office");
export const NODE_MODULES = path.join(PLUGIN_DIR, "node_modules");
const req = createRequire(path.join(PLUGIN_DIR, "package.json"));

const PLUGIN_SDK_SPECIFIERS = [
  "@getpaseo/plugin",
  "@getpaseo/plugin/server",
  "@getpaseo/plugin/server/provider",
  "@getpaseo/plugin/server/usage",
  "@getpaseo/plugin/server/acp",
  "@getpaseo/plugin/client",
  "@getpaseo/plugin/client/ui",
  "@getpaseo/plugin/client/react-native",
];

export async function compileClient(entry = path.join(PLUGIN_DIR, "index.client.tsx")) {
  const { build } = req("esbuild");
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "cjs",
    jsx: "automatic",
    platform: "neutral",
    target: "es2020",
    mainFields: ["module", "main"],
    supported: { "async-await": false },
    external: [...PLUGIN_SDK_SPECIFIERS, "@tanstack/react-query", "react", "react/jsx-runtime", "react-native", "zod"],
    logLevel: "silent",
    treeShaking: true,
    write: false,
  });
  const code = result.outputFiles[0].text.replaceAll("get: () => from[key]", "value: from[key]");
  return `(function(require) {\nconst module = { exports: {} };\nconst exports = module.exports;\n${code}\nreturn module.exports;\n})`;
}

const HERMESC = { win32: "win64-bin/hermesc.exe", linux: "linux64-bin/hermesc", darwin: "osx-bin/hermesc" }[process.platform];

// Errors hermesc reports for the bundle, as { line, col, message } (1-based positions in the bundle itself).
export function hermesErrors(bundle) {
  const dir = makeTempDir("office hermes ");
  const file = path.join(dir, "bundle.js");
  // The prefix shares the first line, so line numbers are the bundle's.
  fs.writeFileSync(file, `var factory = ${bundle};\n`);
  const hermesc = path.join(NODE_MODULES, "react-native", "sdks", "hermesc", HERMESC);
  if (!fs.existsSync(hermesc)) throw new Error(`hermesc of react-native 0.81.5 not found at ${hermesc}`);
  let stderr = "";
  try {
    execFileSync(hermesc, ["-emit-binary", "-out", path.join(dir, "bundle.hbc"), file], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  } catch (error) {
    stderr = String(error.stderr ?? error.message);
  }
  const errors = [];
  for (const m of stderr.matchAll(/^.*?:(\d+):(\d+): error: (.*)$/gm)) errors.push({ line: Number(m[1]), col: Number(m[2]), message: m[3].trim() });
  if (stderr && errors.length === 0) throw new Error(`hermesc failed without a located error:\n${stderr}`);
  return errors;
}

// The source line of a bundle position, to name what Hermes rejected.
export const bundleLine = (bundle, line) => bundle.split("\n")[line - 1]?.trim() ?? "";

// Hermes stand-in: Hermes 0.12 cannot compile class syntax ("Invalid expression encountered"); in the app, where the bundle
// goes through globalThis.eval, such a class reads as undefined (getpaseo/paseo#5783 and the owner's two screenshots).
// Hermes reads callee.prototype before Construct (hermesc -dump-bytecode of `new X()`), hence its wording for `new undefined`.
// Only the expressions hermesc rejected are replaced; any other Hermes error fails here instead of being guessed.
export function emulateHermes(bundle, errors) {
  const acorn = req("acorn");
  const ast = acorn.parse(bundle, { ecmaVersion: "latest", sourceType: "script", locations: true });
  const classes = [];
  const news = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "ClassExpression" || node.type === "ClassDeclaration") classes.push(node);
    if (node.type === "NewExpression") news.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === "object") walk(value);
    }
  })(ast);
  const rejected = errors.map((e) => {
    const node = classes.find((c) => c.loc.start.line === e.line && c.loc.start.column + 1 === e.col);
    if (!node || e.message !== "Invalid expression encountered") throw new Error(`Hermes error not emulated: ${e.line}:${e.col} ${e.message}`);
    return node;
  });
  const inside = (n) => rejected.some((c) => n.start >= c.start && n.end <= c.end);
  const edits = [
    ...rejected.map((c) => ({ at: c.start, end: c.end, text: c.type === "ClassDeclaration" ? `var ${c.id.name} = void 0;` : "void 0" })),
    ...news.filter((n) => !inside(n)).flatMap((n) => [
      { at: n.callee.start, end: n.callee.start, text: "(__hermesNew(" },
      { at: n.callee.end, end: n.callee.end, text: "))" },
    ]),
  ].sort((a, b) => b.at - a.at || b.end - a.end);
  let out = bundle;
  for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
  return `(function () {
const __hermesNew = (c) => { if (c == null) throw new TypeError("Cannot read property 'prototype' of " + c); return c; };
return ${out};
})()`;
}

// ---------------------------------------------------------------- host runtime

export async function createHost() {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // Both hosts (browser, React Native) provide the frame clock Animated drives.
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(performance.now()), 16);
  globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
  // react-native-web's Image loads its source through the browser's Image (no document: its DOM paths stay off).
  globalThis.window ??= {
    Image: function BrowserImage() {
      const image = { onload: null, onerror: null, naturalWidth: 0, naturalHeight: 0 };
      Object.defineProperty(image, "src", { set: () => setTimeout(() => image.onload?.({ target: image }), 0) });
      return image;
    },
  };
  const React = req("react");
  const RNW = req("react-native-web");
  const TestRenderer = req("react-test-renderer");
  const importPlugin = (sub) => import(pathToFileURL(req.resolve(`@getpaseo/plugin${sub}`)).href);
  const [sdk, sdkClient, sdkHost] = await Promise.all([importPlugin(""), importPlugin("/client"), importPlugin("/client/host")]);

  // Export names of react-native 0.81.5 (index.js getters): the phone host's react-native.
  const nativeNames = new Set([...fs.readFileSync(req.resolve("react-native/index.js"), "utf8").matchAll(/^\s+get (\w+)\(\)/gm)].map((m) => m[1]));
  const missing = new Set();
  const reactNative = new Proxy(RNW, {
    get(target, name) {
      if (typeof name !== "string") return undefined;
      if (!nativeNames.has(name) || !(name in target)) {
        missing.add(name);
        return undefined;
      }
      return target[name];
    },
  });

  const e = React.createElement;
  // @getpaseo/plugin/client/ui as the host supplies it (the SDK's own module is empty at run time).
  const ui = {
    SidebarRow: ({ label, onPress, active }) => e(RNW.Pressable, { onPress, accessibilityState: { selected: !!active } }, e(RNW.Text, null, label ?? "")),
    SidebarSeparator: () => e(RNW.View, null),
  };
  for (const name of ["SettingsGroup", "SettingsSection", "SettingsCard", "SettingsRow", "SettingsSwitch", "SettingsSelect", "SettingsInput", "SettingsAction", "ExternalLink"]) {
    ui[name] = ({ children }) => e(RNW.View, null, children);
  }
  // @getpaseo/plugin/client/react-native: the host's pluginReactNativeRuntime.
  const pluginReactNativeRuntime = {
    Icon: ({ name }) => e(RNW.Text, null, name),
    Modal: Object.assign(({ children }) => e(RNW.View, null, children), { Content: ({ children }) => e(RNW.View, null, children) }),
    ScrollView: RNW.ScrollView,
    FlatList: RNW.FlatList,
    TextInput: RNW.TextInput,
    copyText: async () => {},
    useRevealedText: (text) => text,
    useToast: () => ({ show() {}, error() {} }),
  };
  const modules = {
    react: React,
    "react/jsx-runtime": req("react/jsx-runtime"),
    "react-native": reactNative,
    "@getpaseo/plugin": sdk,
    "@getpaseo/plugin/client": { ...sdkClient, useSettings: () => ({}), openExternalUrl: async () => {}, getPaseoClient: () => null, useHosts: () => [] },
    "@getpaseo/plugin/client/ui": ui,
    "@getpaseo/plugin/client/react-native": pluginReactNativeRuntime,
    "@tanstack/react-query": req("@tanstack/react-query"),
    zod: req("zod"),
  };
  const hostRequire = (name) => {
    if (name in modules) return modules[name];
    throw new Error(`Module "${name}" is not available in plugin client code`);
  };

  // The real server entry answers every RPC; payloads cross as JSON both ways, like the real host.
  const server = fakeServer();
  const serverModule = await import(pathToFileURL(path.join(PLUGIN_DIR, "index.server.ts")).href);
  const disposeServer = serverModule.default(server);
  const roundTrip = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
  const invoke = async (method, input) => {
    const handler = server.handlers.get(method);
    if (!handler) throw new Error(`no handler for ${method}`);
    return roundTrip(await handler(roundTrip(input), { paseo: fakePaseo() }));
  };

  // The host's SurfaceErrorBoundary (packages/app/src/plugins/surface-error-boundary.tsx): "Plugin failed: <message>".
  class SurfaceErrorBoundary extends React.Component {
    state = { error: null };
    static getDerivedStateFromError(error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
    render() {
      return this.state.error ? e(RNW.Text, { testID: "plugin-failed" }, `Plugin failed: ${this.state.error}`) : this.props.children;
    }
  }

  const hostProps = {
    theme: { colors: { statusDanger: "#c00", foreground: "#000", background: "#fff", foregroundMuted: "#666", border: "#ccc", surface0: "#fff" } },
    host: { id: "local", label: "Local" },
    layout: { compact: false, platform: "android" },
  };

  const act = TestRenderer.act;
  const settle = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  // Mounts a component the way the host mounts a plugin surface, lets its effects and RPCs settle, and reports the
  // host's failure line (null when it rendered) and the renderer, which the caller unmounts.
  async function render(Component, props, settleMs = 100) {
    const tree = e(
      sdkHost.PaseoApiProvider,
      { paseo: fakePaseo() },
      e(sdkHost.PluginRpcProvider, { invoke }, e(SurfaceErrorBoundary, null, e(Component, { ...hostProps, ...props }))),
    );
    let renderer;
    const original = console.error;
    console.error = () => {};
    try {
      await act(async () => {
        renderer = TestRenderer.create(tree);
      });
      await settle(settleMs);
    } finally {
      console.error = original;
    }
    const failed = renderer.root.findAll((n) => typeof n.type !== "string" && n.props.testID === "plugin-failed");
    return { renderer, failure: failed.length ? textOf(failed[0]) : null };
  }

  // Evaluates the bundle as runPluginClientBundle does and records what contribute() registers.
  function contribute(bundle) {
    const factory = (0, eval)(bundle);
    if (typeof factory !== "function") throw new Error("client bundle is not executable");
    const setup = factory(hostRequire)?.default;
    if (typeof setup !== "function") throw new Error("client bundle must default export a function");
    const screens = [];
    const sidebarItems = [];
    const isComponent = (c) => typeof c === "function" || (typeof c === "object" && c !== null && "$$typeof" in c);
    const registrar = (list, kind) => (c) => {
      if (!isComponent(c.Component)) throw new Error(`${kind} ${c.id} is not a component`);
      list.push({ kind, ...c });
      return () => {};
    };
    const cleanup = setup({
      addScreen: registrar(screens, "screen"),
      addSidebarHeaderItem: registrar(sidebarItems, "sidebar header item"),
      addSidebarFooterItem: registrar(sidebarItems, "sidebar footer item"),
    });
    if (typeof cleanup !== "function") throw new Error("contribution must return a cleanup function");
    return { screens, sidebarItems, cleanup };
  }

  return { act, contribute, disposeServer, missing, render };
}

function textOf(node) {
  if (typeof node === "string") return node;
  return (node.children ?? []).map(textOf).join("");
}

// usePaseo() with the shapes of @getpaseo/client 0.12.0 (agents, workspaces, projects, timeline, observeEvents).
export function fakePaseo() {
  const agent = { id: "agent-1", status: "running", title: "probe", labels: {} };
  const release = async () => {};
  const owned = () => ({ ready: Promise.resolve(), release });
  return {
    agents: {
      list: async () => ({ requestId: "r1", entries: [{ agent, project: null }], pageInfo: { hasMore: false }, subscription: { release } }),
      subscribe: () => () => {},
      ref: () => ({ timeline: { subscribe: () => owned(), refetch: async () => ({ entries: [{ item: { type: "assistant_message", text: "hi" } }] }) } }),
    },
    workspaces: { list: async () => ({ requestId: "r2", entries: [], pageInfo: { hasMore: false }, subscription: { release } }), subscribe: () => () => {} },
    projects: { list: async () => ({ projects: [] }), subscribe: () => () => {} },
    observeEvents: () => owned(),
  };
}
