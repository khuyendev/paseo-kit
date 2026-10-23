// Machine test kit: a temp kit copy, a temp home with a fake Paseo config, fake Claude/Paseo/npm CLIs (INST-29, INV-57).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testEnv } from "../helpers/env.mjs";
import { KIT_DIR, makeTempDir } from "../helpers/temp.mjs";
import { run } from "../../kit/machine/index.mjs";

const FAKES = fileURLToPath(new URL("./fakes/", import.meta.url));
export const SHIPPED_TEMPLATE = path.join(KIT_DIR, "paseo", "providers.json");
export const TOKEN = "fixture-secret";
export const ENDPOINT = "https://proxy.example.test/v1";

const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

// {live: object|null (null = no config file), template, defaults(patch fn), plugins: {folder: id}, env overrides}
export function makeMachine({ live = { agents: { providers: {} } }, template, defaults, plugins, env = {} } = {}) {
  const kitDir = makeTempDir("paseo kit copy ");
  const logs = makeTempDir("paseo kit logs ");
  const lockDir = makeTempDir("paseo kit lock ");
  writeJson(path.join(kitDir, "paseo", "providers.json"), template ?? readJson(SHIPPED_TEMPLATE));
  const shipped = readJson(path.join(KIT_DIR, "ship", ".agents", "harness.defaults.json"));
  writeJson(path.join(kitDir, "ship", ".agents", "harness.defaults.json"), defaults ? defaults(shipped) : shipped);
  fs.cpSync(path.join(KIT_DIR, "user", "skills", "kit-init"), path.join(kitDir, "user", "skills", "kit-init"), { recursive: true });
  for (const [folder, id] of Object.entries(plugins ?? {})) writeJson(path.join(kitDir, "plugins", folder, "paseo-plugin.json"), { id });
  const e = testEnv({
    CLAUDE_CLI: path.join(FAKES, "fake-claude.mjs"),
    PASEO_CLI: path.join(FAKES, "fake-paseo.mjs"),
    npm_execpath: path.join(FAKES, "fake-npm-cli.mjs"),
    FAKE_CLAUDE_LOG: path.join(logs, "claude.log"),
    FAKE_PASEO_LOG: path.join(logs, "paseo.log"),
    FAKE_NPM_LOG: path.join(logs, "npm.log"),
    ANTHROPIC_BASE_URL: undefined,
    ANTHROPIC_AUTH_TOKEN: undefined,
    ...env,
  });
  const home = e.HOME;
  const config = path.join(e.PASEO_HOME, "config.json");
  if (live) writeJson(config, live);
  const logOf = (name) => {
    const file = path.join(logs, `${name}.log`);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  };
  return {
    kitDir,
    home,
    lockDir,
    env: e,
    config,
    skillDir: path.join(kitDir, "user", "skills", "kit-init"),
    readConfig: () => readJson(config),
    configBytes: () => fs.readFileSync(config),
    backups: () => fs.readdirSync(path.dirname(config)).filter((f) => /^config\.json\.bak-/.test(f)),
    logOf,
    async run(argv, envOverrides = {}) {
      const out = [];
      const err = [];
      const runEnv = { ...e, ...envOverrides };
      for (const [k, v] of Object.entries(envOverrides)) if (v === undefined) delete runEnv[k];
      const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: runEnv, kitDir, lockDir });
      return { code, out, err, stdout: out.join("\n") };
    },
  };
}

export const SECRETS = { PASEO_KIT_ANTHROPIC_BASE_URL: ENDPOINT, PASEO_KIT_ANTHROPIC_AUTH_TOKEN: TOKEN };

// A live config holding everything the shipped template and policy need (apply on an empty config).
export async function completeMachine(opts = {}) {
  const m = makeMachine(opts);
  const r = await m.run(["apply", "--no-reload"], SECRETS);
  if (r.code !== 0) throw new Error(`setup apply failed (${r.code}): ${r.stdout}\n${r.err.join("\n")}`);
  return m;
}

// Bytes and mtimes of files, and of every entry below a directory (links recorded by their target).
export function snapshot(paths) {
  const out = [];
  const visit = (f) => {
    if (!fs.existsSync(f) && !isLink(f)) return out.push({ f, missing: true });
    const st = fs.lstatSync(f);
    if (st.isSymbolicLink()) return out.push({ f, link: fs.readlinkSync(f) });
    if (st.isDirectory()) {
      out.push({ f, dir: true });
      for (const name of fs.readdirSync(f).sort()) visit(path.join(f, name));
      return;
    }
    out.push({ f, bytes: fs.readFileSync(f).toString("base64"), mtime: st.mtimeMs });
  };
  paths.forEach(visit);
  return out;
}

function isLink(f) {
  try {
    return fs.lstatSync(f).isSymbolicLink();
  } catch {
    return false;
  }
}

export const levels = (r) => r.out.map((l) => l.split(" ")[0]);
