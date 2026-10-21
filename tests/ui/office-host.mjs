// Fake Paseo host for the office plugin: runs the real server handler and the real client source, offline.
// The client graph is transpiled from TypeScript in Node, evaluated against a fake react-native, and rendered by a
// small hook-aware renderer (no DOM, no daemon). Later plans extend the fake react-native names here only through a
// shared_changes request to the plan that owns this file (07-01).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { KIT_DIR } from "../helpers/temp.mjs";
import { fakeServer } from "./fake-paseo.mjs";

const PLUGIN_DIR = path.join(KIT_DIR, "plugins", "office");
const pluginRequire = createRequire(path.join(PLUGIN_DIR, "package.json"));
const ts = pluginRequire("typescript");
const React = pluginRequire("react");
const jsxRuntime = pluginRequire("react/jsx-runtime");
const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

const tick = () => new Promise((resolve) => setImmediate(resolve));
const roundTrip = (value) => JSON.parse(JSON.stringify(value));
const E_ELEMENT = Symbol.for("react.transitional.element");
const E_CONTEXT = Symbol.for("react.context");
const E_PROVIDER = Symbol.for("react.provider");
const E_MEMO = Symbol.for("react.memo");
const E_FORWARD = Symbol.for("react.forward_ref");

// Proxy whose capitalised names are host-element strings ("View", "Text", "SidebarRow", ...).
function hostNames(extra = {}) {
  return new Proxy(extra, {
    get(target, name) {
      if (name in target) return target[name];
      return typeof name === "string" && /^[A-Z]/.test(name) ? name : undefined;
    },
  });
}

// ---------------------------------------------------------------- fake react-native

function createAnimated(animations) {
  class Value {
    constructor(initial) {
      this.current = initial;
      this.offset = 0;
      this.listeners = new Map();
      this.nextId = 1;
    }
    setValue(n) {
      this.current = n;
      for (const fn of [...this.listeners.values()]) fn({ value: n });
    }
    addListener(fn) {
      const id = String(this.nextId++);
      this.listeners.set(id, fn);
      return id;
    }
    removeListener(id) {
      this.listeners.delete(id);
    }
    removeAllListeners() {
      this.listeners.clear();
    }
    stopAnimation(cb) {
      if (cb) cb(this.current);
    }
    interpolate(config) {
      return { parent: this, config };
    }
    setOffset(n) {
      this.offset = n;
    }
    flattenOffset() {
      this.current += this.offset;
      this.offset = 0;
    }
    extractOffset() {
      this.offset = this.current;
      this.current = 0;
    }
  }

  class ValueXY {
    constructor(initial = { x: 0, y: 0 }) {
      this.x = new Value(initial.x);
      this.y = new Value(initial.y);
      this.listeners = new Map();
      this.nextId = 1;
    }
    get current() {
      return { x: this.x.current, y: this.y.current };
    }
    setValue({ x, y }) {
      this.x.setValue(x);
      this.y.setValue(y);
    }
    addListener(fn) {
      const id = String(this.nextId++);
      const call = () => fn(this.current);
      this.listeners.set(id, [this.x.addListener(call), this.y.addListener(call)]);
      return id;
    }
    removeListener(id) {
      const ids = this.listeners.get(id);
      if (!ids) return;
      this.x.removeListener(ids[0]);
      this.y.removeListener(ids[1]);
      this.listeners.delete(id);
    }
  }

  // A timing or delay handle; the log entry is the observable record of the animation.
  function leaf(value, config, duration) {
    const entry = { value, config, stopped: false };
    animations.push(entry);
    return {
      entry,
      start(callback) {
        if (duration !== 0) return;
        if (value instanceof Value && typeof config?.toValue === "number") value.setValue(config.toValue);
        callback?.({ finished: true });
      },
      stop() {
        entry.stopped = true;
      },
      reset() {},
    };
  }

  function group(handles) {
    return {
      start(callback) {
        let finished = 0;
        for (const h of handles) h.start(() => finished++);
        if (finished === handles.length) callback?.({ finished: true });
      },
      stop() {
        for (const h of handles) h.stop();
      },
      reset() {
        for (const h of handles) h.reset();
      },
    };
  }

  return {
    Value,
    ValueXY,
    timing: (value, config) => leaf(value, config, config?.duration ?? 500),
    delay: (ms) => leaf(null, { delay: ms, duration: ms }, ms),
    sequence: (handles) => group(handles),
    parallel: (handles) => group(handles),
    stagger: (_ms, handles) => group(handles),
    loop: (handle) => ({
      start() {
        handle.start(() => {});
      },
      stop: () => handle.stop(),
      reset: () => handle.reset(),
    }),
    event: () => () => {},
    View: "Animated.View",
    Text: "Animated.Text",
    Image: "Animated.Image",
    ScrollView: "Animated.ScrollView",
  };
}

function createReactNative(animations) {
  const identity = (t) => t;
  const easing = new Proxy({ linear: identity }, { get: (target, name) => (name in target ? target[name] : typeof name === "string" ? () => identity : undefined) });
  const flatten = (style) => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
  return hostNames({
    Animated: createAnimated(animations),
    Easing: easing,
    Platform: { OS: "web", select: (options) => options.web ?? options.default },
    StyleSheet: { create: (styles) => styles, flatten, hairlineWidth: 1, absoluteFill: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 } },
    useWindowDimensions: () => ({ width: 1280, height: 800, scale: 1, fontScale: 1 }),
  });
}

// ---------------------------------------------------------------- TypeScript client loader

function createLoader(shims) {
  const modules = new Map();

  function resolveFile(spec, fromDir) {
    const base = path.isAbsolute(spec) ? spec : path.resolve(fromDir, spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`unmapped import: ${spec}`);
  }

  function requireFrom(fromDir) {
    return (spec) => {
      if (spec.startsWith(".") || path.isAbsolute(spec)) return loadFile(resolveFile(spec, fromDir));
      if (Object.hasOwn(shims, spec)) return shims[spec];
      throw new Error(`unmapped import: ${spec}`);
    };
  }

  function loadFile(abs) {
    const hit = modules.get(abs);
    if (hit) return hit.exports;
    const source = fs.readFileSync(abs, "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: abs,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    });
    const mod = { exports: {} };
    modules.set(abs, mod);
    new Function("require", "module", "exports", outputText)(requireFrom(path.dirname(abs)), mod, mod.exports);
    return mod.exports;
  }

  return { loadFile };
}

// ---------------------------------------------------------------- renderer

const shallowEqual = (a, b) => {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
};
const sameDeps = (a, b) => a !== undefined && b !== undefined && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));

// Mounts `element` and returns the handle used by tests; hooks live in per-position instances.
function createRenderer(element, props0) {
  let props = props0;
  let dirty = false;
  let mounted = true;
  let tree = null;
  let idCounter = 0;
  const instances = new Map();
  let seen = new Set();
  let passive = [];
  let layout = [];
  let insertion = [];
  let current = null;

  const markDirty = (inst) => {
    inst.dirty = true;
    for (let p = inst.parent; p; p = p.parent) p.subtreeDirty = true;
    dirty = true;
  };

  function runEffects(queue) {
    for (const slot of queue) {
      if (!slot.cleanup) continue;
      const cleanup = slot.cleanup;
      slot.cleanup = null;
      cleanup();
    }
    for (const slot of queue) {
      const create = slot.create;
      slot.create = null;
      const result = create?.();
      slot.cleanup = typeof result === "function" ? result : null;
    }
  }

  function slotAt(make) {
    const inst = current;
    const i = inst.hookIndex++;
    if (i >= inst.hooks.length) inst.hooks.push(make());
    return inst.hooks[i];
  }

  function effect(queueName, create, deps) {
    const slot = slotAt(() => ({ first: true, deps: undefined, cleanup: null, create: null }));
    if (slot.first || !sameDeps(slot.deps, deps)) {
      slot.first = false;
      slot.deps = deps;
      slot.create = create;
      (queueName === "passive" ? passive : queueName === "layout" ? layout : insertion).push(slot);
    }
  }

  const dispatcher = {
    useState(initial) {
      const inst = current;
      const slot = slotAt(() => ({ value: typeof initial === "function" ? initial() : initial }));
      return [
        slot.value,
        (next) => {
          const value = typeof next === "function" ? next(slot.value) : next;
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          markDirty(inst);
        },
      ];
    },
    useReducer(reducer, initialArg, init) {
      const inst = current;
      const slot = slotAt(() => ({ value: init ? init(initialArg) : initialArg, reducer }));
      slot.reducer = reducer;
      return [
        slot.value,
        (action) => {
          const value = slot.reducer(slot.value, action);
          if (Object.is(value, slot.value)) return;
          slot.value = value;
          markDirty(inst);
        },
      ];
    },
    useRef(initial) {
      return slotAt(() => ({ current: initial }));
    },
    useMemo(factory, deps) {
      const slot = slotAt(() => ({ deps: undefined, value: undefined, ready: false }));
      if (!slot.ready || !sameDeps(slot.deps, deps)) {
        slot.value = factory();
        slot.deps = deps;
        slot.ready = true;
      }
      return slot.value;
    },
    useCallback(callback, deps) {
      return dispatcher.useMemo(() => callback, deps);
    },
    useEffect: (create, deps) => effect("passive", create, deps),
    useLayoutEffect: (create, deps) => effect("layout", create, deps),
    useInsertionEffect: (create, deps) => effect("insertion", create, deps),
    useContext(context) {
      const map = current.env;
      const base = context._currentValue;
      return map.has(context) ? map.get(context) : base;
    },
    useId() {
      return slotAt(() => ({ id: `:r${(idCounter++).toString(36)}:` })).id;
    },
    useImperativeHandle(ref, create, deps) {
      effect(
        "layout",
        () => {
          const handle = create();
          if (typeof ref === "function") ref(handle);
          else if (ref) ref.current = handle;
          return () => {
            if (typeof ref === "function") ref(null);
            else if (ref) ref.current = null;
          };
        },
        deps === undefined ? undefined : [...deps, ref],
      );
    },
    useDebugValue() {},
    useSyncExternalStore(subscribe, getSnapshot) {
      const inst = current;
      effect("layout", () => subscribe(() => markDirty(inst)), [subscribe]);
      return getSnapshot();
    },
  };

  const dispatcherProxy = new Proxy(dispatcher, {
    get(target, name) {
      if (name in target) return target[name];
      if (typeof name === "string" && name.startsWith("use")) {
        return () => {
          throw new Error(`unsupported hook: ${name}`);
        };
      }
      return undefined;
    },
  });

  function releaseInstance(inst) {
    for (const slot of inst.hooks) {
      if (slot.cleanup) {
        const cleanup = slot.cleanup;
        slot.cleanup = null;
        cleanup();
      }
    }
  }

  function instanceAt(p, type, parent) {
    let inst = instances.get(p);
    if (inst && inst.type !== type) {
      releaseInstance(inst);
      instances.delete(p);
      inst = undefined;
    }
    if (!inst) {
      inst = { path: p, type, parent, hooks: [], hookIndex: 0, dirty: false, subtreeDirty: false, rendered: false, lastProps: null, lastOutput: null, env: null };
      instances.set(p, inst);
    }
    inst.parent = parent;
    seen.add(p);
    return inst;
  }

  function callFunction(inst, fn, componentProps, env, ref) {
    const previous = internals.H;
    const before = current;
    current = inst;
    inst.hookIndex = 0;
    inst.env = env;
    inst.dirty = false;
    inst.subtreeDirty = false;
    internals.H = dispatcherProxy;
    try {
      return fn(componentProps, ref);
    } finally {
      internals.H = previous;
      current = before;
    }
  }

  function renderChildren(children, p, env, parent) {
    const out = [];
    const walk = (node, path0) => {
      if (Array.isArray(node)) {
        node.forEach((child, i) => walk(child, `${path0}/${i}`));
        return;
      }
      const rendered = renderNode(node, path0, env, parent);
      if (Array.isArray(rendered)) out.push(...rendered);
      else if (rendered !== null) out.push(rendered);
    };
    walk(children, p);
    return out;
  }

  function renderNode(node, p, env, parent) {
    if (node === null || node === undefined || typeof node === "boolean") return null;
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (!React.isValidElement(node)) throw new Error(`unsupported node at ${p}`);
    const { type } = node;
    const pathHere = node.key === null || node.key === undefined ? p : `${p}#${node.key}`;
    if (typeof type === "string") {
      const { children, ...rest } = node.props;
      return { type, props: rest, children: renderChildren(children, pathHere, env, parent) };
    }
    if (type === React.Fragment) return renderChildren(node.props.children, pathHere, env, parent);
    if (type && (type.$$typeof === E_CONTEXT || type.$$typeof === E_PROVIDER)) {
      const context = type.$$typeof === E_PROVIDER ? type._context : type;
      const nextEnv = new Map(env);
      nextEnv.set(context, node.props.value);
      return renderChildren(node.props.children, pathHere, nextEnv, parent);
    }
    const memo = type && type.$$typeof === E_MEMO ? type : null;
    const inner = memo ? memo.type : type;
    const forward = inner && inner.$$typeof === E_FORWARD ? inner : null;
    const fn = forward ? forward.render : inner;
    if (typeof fn !== "function" || (fn.prototype && fn.prototype.isReactComponent)) throw new Error(`unsupported component type at ${p}`);
    const inst = instanceAt(pathHere, type, parent);
    if (memo && inst.rendered && !inst.dirty && !inst.subtreeDirty && (memo.compare ?? shallowEqual)(inst.lastProps, node.props)) {
      for (const key of instances.keys()) if (key.startsWith(`${pathHere}/`)) seen.add(key);
      return inst.lastOutput;
    }
    let output;
    if (forward) {
      const { ref, ...rest } = node.props;
      output = callFunction(inst, fn, rest, env, ref);
    } else {
      output = callFunction(inst, fn, node.props, env, undefined);
    }
    const rendered = renderChildren(output, `${pathHere}/o`, env, inst);
    inst.rendered = true;
    inst.lastProps = node.props;
    inst.lastOutput = rendered;
    return rendered;
  }

  function runPassive() {
    if (passive.length === 0) return false;
    const queue = passive;
    passive = [];
    runEffects(queue);
    return true;
  }

  function pass() {
    runPassive();
    seen = new Set();
    layout = [];
    insertion = [];
    dirty = false;
    const out = renderChildren(React.createElement(element, props), "r", new Map(), null);
    for (const [key, inst] of [...instances]) {
      if (seen.has(key)) continue;
      releaseInstance(inst);
      instances.delete(key);
    }
    tree = out.length === 1 ? out[0] : out;
    runEffects(insertion);
    runEffects(layout);
  }

  const walkNodes = (node, type, found) => {
    if (Array.isArray(node)) node.forEach((n) => walkNodes(n, type, found));
    else if (node && typeof node === "object") {
      if (node.type === type) found.push(node);
      walkNodes(node.children, type, found);
    }
    return found;
  };

  pass();
  return {
    get tree() {
      return tree;
    },
    find: (type) => walkNodes(tree, type, []),
    async flush() {
      for (let round = 0; round < 50; round++) {
        let worked = runPassive();
        if (dirty && mounted) {
          pass();
          worked = true;
        }
        await tick();
        if (!worked && !dirty && passive.length === 0) return;
      }
      throw new Error("flush did not settle after 50 rounds");
    },
    rerender(nextProps) {
      if (nextProps !== undefined) props = nextProps;
      pass();
    },
    unmount() {
      if (!mounted) return;
      runPassive();
      mounted = false;
      for (const inst of instances.values()) releaseInstance(inst);
      instances.clear();
      tree = null;
    },
  };
}

// ---------------------------------------------------------------- the host

const colors = new Proxy({}, { get: (_target, name) => (typeof name === "string" ? "#808080" : undefined) });

// fakeHost(options): options.paseo is returned by usePaseo and handed to the server handlers as ctx.paseo.
export async function fakeHost(options = {}) {
  const animations = [];
  const rpcCalls = [];
  const cleanups = [];
  const handles = [];
  const screens = [];
  const sidebarItems = [];
  const paseo = options.paseo ?? {};
  const counted = (name) => {
    const record = { name, ran: false };
    cleanups.push(record);
    return () => {
      record.ran = true;
    };
  };

  const server = fakeServer();
  const serverModule = await import(pathToFileURL(path.join(PLUGIN_DIR, "index.server.ts")).href);
  const disposeServer = serverModule.default(server);
  const serverRan = counted("server");

  const pluginDist = path.dirname(pluginRequire.resolve("@getpaseo/plugin"));
  const plugin = await import(pathToFileURL(path.join(pluginDist, "index.js")).href);
  const { callPluginRpc } = await import(pathToFileURL(path.join(pluginDist, "rpc.js")).href);

  // Every payload crosses the wire as JSON in both directions, like the real host.
  const invoke = async (method, input) => {
    const payload = roundTrip(input);
    rpcCalls.push({ method, input: payload });
    const handler = server.handlers.get(method);
    if (!handler) throw new Error(`no handler for ${method}`);
    return roundTrip(await handler(payload, { paseo }));
  };

  const loader = createLoader({
    react: React,
    "react/jsx-runtime": jsxRuntime,
    "@getpaseo/plugin": plugin,
    zod: pluginRequire("zod"),
    "react-native": createReactNative(animations),
    "@getpaseo/plugin/client": {
      usePaseo: () => paseo,
      useRpc: (contract) => (input) => callPluginRpc(contract, invoke, input),
      useAgent: () => null,
      useWorkspace: () => null,
      openExternalUrl: async () => {},
    },
    "@getpaseo/plugin/client/ui": hostNames(),
    "@getpaseo/plugin/client/react-native": hostNames(),
  });

  const recorder = {
    addScreen(contribution) {
      screens.push(contribution);
      return counted(`screen:${contribution.id}`);
    },
    addSidebarHeaderItem(contribution) {
      sidebarItems.push(contribution);
      return counted(`sidebar:${contribution.id}`);
    },
  };
  const disposeClient = loader.loadFile(path.join(PLUGIN_DIR, "index.client.tsx")).default(recorder);

  const screenProps = (overrides = {}) => ({
    theme: { colors },
    host: { id: "fake", label: "fake" },
    layout: { compact: false, platform: "web" },
    params: {},
    ...overrides,
  });

  // Mounts any client component with exactly the given props; an absolute path loads a fixture from outside the plugin.
  function mountModule(relPath, exportName, props) {
    const abs = path.isAbsolute(relPath) ? relPath : path.join(PLUGIN_DIR, relPath);
    const Component = loader.loadFile(abs)[exportName];
    if (Component === undefined) throw new Error(`no export ${exportName} in ${relPath}`);
    const handle = createRenderer(Component, props);
    handles.push(handle);
    return handle;
  }

  function mount(screenId, props = {}) {
    const screen = screens.find((s) => s.id === screenId);
    if (!screen) throw new Error(`no screen ${screenId}`);
    const handle = createRenderer(screen.Component, screenProps(props));
    handles.push(handle);
    return handle;
  }

  return {
    screens,
    sidebarItems,
    rpcCalls,
    animations,
    cleanups,
    screenProps,
    mount,
    mountModule,
    render: mountModule,
    dispose() {
      for (const handle of handles) handle.unmount();
      void disposeClient();
      void disposeServer();
      serverRan();
    },
  };
}
