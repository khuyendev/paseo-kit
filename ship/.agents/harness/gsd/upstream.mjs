// Upstream GSD carriage (GSDC-44..48, GSDC-53, D-62, D-111, INV-40): a trimmed pinned snapshot read from a local
// clone without running anything in it, generated agents and method texts (upstream body + three path rewrites),
// verbatim contract blocks by anchor, and a check that fails on drift, dangling references or unmapped verbs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readJson, writeJsonAtomic, writeTextAtomic } from "../lib/io.mjs";
import { textDigest } from "../lib/hash.mjs";
import { isInside as isInsideReal, toSlash } from "../lib/paths.mjs";
import { done, escapeRe, fail, lf, today } from "./common.mjs";

export const INSTALL_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const SNAPSHOT_REL = ".agents/gsd/upstream";
export const INVENTORY_REL = ".agents/gsd/inventory.json";
const MAX_DEPTH = 3;

// --- the three path rewrites (GSDC-45) ---

export function rewritePaths(text) {
  return text
    .replace(/(@?)~\/\.claude\/gsd-core\//g, `$1${SNAPSHOT_REL}/gsd-core/`)
    .replace(/@gsd-core\//g, `@${SNAPSHOT_REL}/gsd-core/`)
    .replace(/(?<![\w./@~-])gsd-core\/(references|templates|workflows|contexts)\//g, `${SNAPSHOT_REL}/gsd-core/$1/`);
}

// Snapshot-relative files a text refers to (raw upstream forms and rewritten forms).
export function extractRefs(text) {
  const out = new Set();
  const ext = "[A-Za-z0-9_./-]*?\\.(?:md|json|cjs|js|sh|ya?ml)(?![A-Za-z0-9_])";
  for (const m of text.matchAll(new RegExp(`(?:${SNAPSHOT_REL.replace(/\./g, "\\.")}/)?gsd-core/((?:references|templates|workflows|contexts)/${ext})`, "g"))) out.add(`gsd-core/${m[1]}`);
  for (const m of text.matchAll(new RegExp(`(?<![\\w./@~-])((?:workflows|references|templates)/[a-z0-9-]+/${ext})`, "g"))) out.add(`gsd-core/${m[1]}`);
  return [...out].map((p) => p.replace(/\.+$/, ""));
}

// --- clone HEAD without git (GSDC-44: hooks or fsmonitor in an untrusted clone must never run) ---

export function cloneHead(clone) {
  let gitDir = path.join(clone, ".git");
  if (!fs.existsSync(gitDir)) throw fail(`${clone} has no .git`);
  if (fs.statSync(gitDir).isFile()) {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(gitDir, "utf8"));
    if (!m) throw fail(`${gitDir} is not a gitdir file`);
    gitDir = path.resolve(clone, m[1].trim());
  }
  const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
  const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
  if (!ref) return { commit: head, branch: null };
  const branch = ref.replace(/^refs\/heads\//, "");
  const loose = path.join(gitDir, ...ref.split("/"));
  if (fs.existsSync(loose)) return { commit: fs.readFileSync(loose, "utf8").trim(), branch };
  const commonDir = fs.existsSync(path.join(gitDir, "commondir")) ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()) : gitDir;
  for (const dir of [gitDir, commonDir]) {
    const packed = path.join(dir, "packed-refs");
    if (!fs.existsSync(packed)) continue;
    const line = fs.readFileSync(packed, "utf8").split(/\r?\n/).find((l) => l.endsWith(` ${ref}`));
    if (line) return { commit: line.split(" ")[0], branch };
    const looseCommon = path.join(dir, ...ref.split("/"));
    if (fs.existsSync(looseCommon)) return { commit: fs.readFileSync(looseCommon, "utf8").trim(), branch };
  }
  throw fail(`cannot resolve HEAD ${ref} in ${clone}`);
}

// --- layout of a target (the kit's ship/ or an installed project) ---

function layout(target) {
  const abs = (rel) => path.join(target, ...rel.split("/"));
  const inventory = readJson(abs(INVENTORY_REL));
  return { target, abs, inventory, snapshot: abs(SNAPSHOT_REL), pinFile: abs(`${SNAPSHOT_REL}/UPSTREAM.json`) };
}

const readPin = (L) => (fs.existsSync(L.pinFile) ? readJson(L.pinFile) : null);

// A relative path inside a root: forward slashes only, no empty, `.` or `..` segment, not absolute (INV-40).
export const safeRel = (rel) => {
  const s = String(rel ?? "");
  return s !== "" && !s.includes("\\") && !s.startsWith("/") && !/^[A-Za-z]:/.test(s) && s.split("/").every((seg) => seg && seg !== "." && seg !== "..");
};

// The kind of root/rel without following a link or junction anywhere on the way (an ancestor link is refused too).
function lstatInside(root, rel) {
  if (!safeRel(rel)) return "unsafe";
  const parts = rel.split("/");
  for (let i = 1; i <= parts.length; i++) {
    const st = fs.lstatSync(path.join(root, ...parts.slice(0, i)), { throwIfNoEntry: false });
    if (!st) return "missing";
    if (st.isSymbolicLink()) return "symlink";
    if (i < parts.length && !st.isDirectory()) return "missing";
    if (i === parts.length) return st.isFile() ? "file" : "other";
  }
  return "other";
}

// Seeds (inventory sources) plus every file they reach, up to depth 3, that exists in the clone.
function reachable(clone, seeds) {
  const files = new Set();
  const absent = new Set();
  let frontier = [...seeds];
  for (let depth = 0; depth <= MAX_DEPTH && frontier.length; depth++) {
    const next = [];
    for (const rel of frontier) {
      if (files.has(rel)) continue;
      const kind = lstatInside(clone, rel);
      if (kind === "unsafe") throw fail(`refusing a path that is absolute or leaves the upstream clone: ${rel}`);
      if (kind === "symlink") throw fail(`refusing symlink in the upstream clone: ${rel}`);
      if (kind !== "file") {
        if (depth === 0) throw fail(`upstream clone lacks ${rel}`);
        absent.add(rel);
        continue;
      }
      files.add(rel);
      if (/\.(md|json)$/.test(rel)) next.push(...extractRefs(fs.readFileSync(path.join(clone, ...rel.split("/")), "utf8")));
    }
    frontier = next;
  }
  return { files: [...files].sort(), absent: [...absent].filter((f) => !files.has(f)).sort() };
}

export function vendor(L, clone, commitArg) {
  const pin = readPin(L);
  const want = commitArg ?? pin?.commit;
  if (!want) throw fail("no pinned commit (UPSTREAM.json) and no --commit");
  const head = cloneHead(clone);
  if (head.commit !== want) throw fail(`upstream clone HEAD ${head.commit} differs from the pin ${want}`);
  const seeds = L.inventory.entries.filter((e) => e.source !== "kit-authored").map((e) => e.source);
  const { files, absent } = reachable(clone, [...new Set(seeds)]);
  // Every source is read and checked before the snapshot is touched.
  const realClone = fs.realpathSync.native(clone);
  const texts = new Map();
  for (const rel of files) {
    const real = fs.realpathSync.native(path.join(clone, ...rel.split("/")));
    if (!isInsideReal(real, realClone)) throw fail(`refusing a file outside the upstream clone: ${rel}`);
    const buf = fs.readFileSync(real);
    if (buf.includes(0)) throw fail(`refusing binary file from the upstream clone: ${rel}`);
    texts.set(rel, buf.toString("utf8"));
  }
  fs.rmSync(L.snapshot, { recursive: true, force: true });
  const hashes = {};
  for (const [rel, text] of texts) {
    writeTextAtomic(path.join(L.snapshot, ...rel.split("/")), text);
    hashes[rel] = textDigest(text);
  }
  const record = {
    repo: pin?.repo ?? "open-gsd/gsd-core",
    branch: head.branch ?? pin?.branch ?? null,
    commit: want,
    vendored_commit: head.commit,
    date: today(),
    license: "MIT",
    absent_upstream: absent,
    files: hashes,
  };
  writeJsonAtomic(L.pinFile, record);
  return { commit: want, files: files.length, absent_upstream: absent.length };
}

// Strict snapshot validation: pin, hashes, no extra file (GSDC-45 build precondition, GSDC-47 check).
export function snapshotProblems(L) {
  const pin = readPin(L);
  if (!pin) return ["UPSTREAM.json missing"];
  const problems = [];
  if (pin.vendored_commit !== pin.commit) problems.push(`pin mismatch: UPSTREAM.json commit ${pin.commit} but the snapshot was vendored from ${pin.vendored_commit}`);
  for (const [rel, hash] of Object.entries(pin.files ?? {})) {
    if (!safeRel(rel)) {
      problems.push(`UPSTREAM.json names a path outside the snapshot: ${rel}`);
      continue;
    }
    const file = path.join(L.snapshot, ...rel.split("/"));
    if (!fs.existsSync(file)) problems.push(`snapshot file missing: ${rel}`);
    else if (textDigest(fs.readFileSync(file, "utf8")) !== hash) problems.push(`snapshot file edited: ${rel}`);
  }
  const walk = (dir) => {
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else {
        const rel = toSlash(path.relative(L.snapshot, abs));
        if (rel !== "UPSTREAM.json" && !Object.hasOwn(pin.files ?? {}, rel)) problems.push(`file not in UPSTREAM.json: ${rel}`);
      }
    }
  };
  walk(L.snapshot);
  return problems;
}

// --- generation ---

export function splitFrontMatter(text) {
  const lines = lf(text).split("\n");
  if (lines[0].trim() !== "---") return { head: "", body: lf(text) };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  if (end < 0) return { head: "", body: lf(text) };
  return { head: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

const generatedLine = (pin, source) => `<!-- GENERATED by ph gsd upstream build from ${SNAPSHOT_REL}/${source} (${pin.repo}@${String(pin.commit).slice(0, 7)}); do not edit: change the kit overlay or the project adapter -->`;

export const PRECEDENCE_BLOCK = [
  "<kit_adapter_precedence>",
  "This role runs inside the paseo-kit harness. The method below is upstream GSD text, unchanged except for paths into the vendored snapshot.",
  "The kit overlays loaded after it and the project adapter (sections `adapter` and `gsd` of the project harness config) adapt it to this project:",
  "where they conflict with the text below, the overlay and the adapter win. The method itself is unchanged.",
  "</kit_adapter_precedence>",
].join("\n");

const flowList = (items) => `[${items.join(", ")}]`;

function agentText(pin, entry, source) {
  const { head, body } = splitFrontMatter(source);
  const tools = (/^tools:\s*(.+)$/m.exec(head)?.[1] ?? "").split(",").map((t) => t.trim()).filter((t) => t && !t.startsWith("mcp__"));
  const name = path.basename(entry.installed, ".md");
  const fm = ["---", `name: ${name}`, `description: ${JSON.stringify(entry.description)}`, `model: ${entry.model}`, `tools: ${flowList(tools)}`, "include:", ...entry.include.map((i) => `  - ${i}`), "---"];
  return `${fm.join("\n")}\n${generatedLine(pin, entry.source)}\n${PRECEDENCE_BLOCK}\n${rewritePaths(body)}`;
}

// Generated body of an agent (what follows the precedence block); tests compare it with rewritePaths(upstream body).
export const generatedBody = (text) => lf(text).split(`${PRECEDENCE_BLOCK}\n`).slice(1).join(`${PRECEDENCE_BLOCK}\n`);

function extractAnchor(text, anchor, source) {
  let from = 0;
  if (anchor.after) {
    const at = text.search(new RegExp(`^${escapeRe(anchor.after)}`, "m"));
    if (at < 0) throw fail(`missing anchor ${anchor.after} in ${source}`);
    from = at;
  }
  const rest = text.slice(from);
  if (anchor.block) {
    const open = rest.search(new RegExp(`^<${anchor.block}>`, "m"));
    const close = rest.search(new RegExp(`^</${anchor.block}>`, "m"));
    if (open < 0 || close < open) throw fail(`missing anchor <${anchor.block}> in ${source}`);
    return rest.slice(open, rest.indexOf("\n", close) < 0 ? rest.length : rest.indexOf("\n", close));
  }
  const fence = `\`\`\`${anchor.fence}\n`;
  const open = rest.indexOf(fence);
  const close = open < 0 ? -1 : rest.indexOf("\n```", open + fence.length);
  if (open < 0 || close < 0) throw fail(`missing anchor ${anchor.fence} block after ${anchor.after} in ${source}`);
  const block = rest.slice(open + fence.length, close);
  for (const p of anchor.placeholders ?? []) if (!block.includes(p)) throw fail(`missing placeholder ${p} in the block after ${anchor.after} (${source})`);
  return `## ${anchor.after.replace(/^#+\s*/, "")}\n\n${fence}${block}\n\`\`\``;
}

// Every generated file of the inventory, in memory: installed rel path -> text.
export function generate(L) {
  const pin = readPin(L);
  const read = (rel) => fs.readFileSync(path.join(L.snapshot, ...rel.split("/")), "utf8");
  const out = new Map();
  for (const e of L.inventory.entries) {
    if (e.source === "kit-authored" || !e.transformations.length) continue;
    if (!safeRel(e.installed) || !safeRel(e.source)) throw fail(`inventory entry outside its root: ${e.installed} <- ${e.source}`);
    const src = lf(read(e.source));
    if (e.kind === "agent") out.set(e.installed, agentText(pin, e, src));
    else if (e.transformations.includes("anchor-extraction")) {
      const blocks = e.anchors.map((a) => rewritePaths(extractAnchor(src, a, e.source)));
      out.set(e.installed, `${generatedLine(pin, e.source)}\n\n${blocks.join("\n\n")}\n`);
    } else {
      const body = e.transformations.includes("strip-front-matter") ? splitFrontMatter(src).body : src;
      out.set(e.installed, `${generatedLine(pin, e.source)}\n${rewritePaths(body)}`);
    }
  }
  return out;
}

export function build(L) {
  const problems = snapshotProblems(L);
  if (problems.length) throw fail(`snapshot problems (nothing written; change the adapter, never the snapshot): ${problems.join("; ")}`, { problems });
  const files = generate(L);
  const written = [];
  for (const [rel, text] of files) {
    const file = L.abs(rel);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) continue;
    writeTextAtomic(file, text);
    written.push(rel);
  }
  return { generated: files.size, written };
}

// --- check (GSDC-47) ---

// Prose after `gsd_run` that is not a verb ("gsd_run is on PATH").
const PROSE = new Set(["is", "as", "to", "the", "a", "an", "and", "or", "on", "in", "at", "for", "with", "from", "function", "launcher", "call", "calls", "resolves", "resolver", "itself", "via", "not", "when", "which", "that", "binary", "command", "wrapper", "helper"]);

// Verb names named by `gsd_run [query] <verb> [<sub>]`, resolved against the verb table like the dispatcher does;
// a second word counts only after a group word (`check`, `state`, ...), never an argument (`config-get workflow.x`).
const EXTRA_GROUPS = ["windows", "loop", "review-lane", "graphify", "research-store", "quick-batch", "intel", "uat", "worktree", "task"];

export function scanVerbs(text, known) {
  const groups = new Set([...[...known].filter((v) => v.includes(".")).map((v) => v.split(".")[0]), ...EXTRA_GROUPS]);
  const names = new Set();
  for (const m of text.matchAll(/gsd_run\s+(?:query\s+)?([a-z][a-z0-9._-]*)(?:[ \t]+([a-z][a-z0-9-]*))?/g)) {
    const [, v1, v2raw] = m;
    if (PROSE.has(v1) || v1 === "query") continue;
    const v2 = v2raw && !PROSE.has(v2raw) && groups.has(v1) ? v2raw : null;
    names.add(v1.includes(".") ? v1.replace(/\.+$/, "") : v2 ? `${v1}.${v2}` : v1);
  }
  return [...names];
}

export function check(L, known, { verbose = false } = {}) {
  const problems = snapshotProblems(L);
  const warnings = [];
  const pin = readPin(L);
  const snapshotFiles = new Set(Object.keys(pin?.files ?? {}).filter(safeRel));
  const absent = new Set(pin?.absent_upstream ?? []);
  let fresh = new Map();
  if (!problems.length) {
    try {
      fresh = generate(L);
    } catch (e) {
      problems.push(e.message);
    }
  }
  for (const [rel, text] of fresh) {
    const file = L.abs(rel);
    if (!fs.existsSync(file)) problems.push(`generated file missing: ${rel}`);
    else if (lf(fs.readFileSync(file, "utf8")) !== lf(text)) problems.push(`generated file stale or hand-edited: ${rel}`);
  }
  problems.push(...installedProblems(L, fresh));
  let followed = 0;
  const verbTexts = [...fresh.values()];
  const seen = new Set();
  let frontier = [...fresh.values()].flatMap((t) => extractRefs(t).map((ref) => ({ ref, depth: 1 })));
  while (frontier.length) {
    const next = [];
    for (const { ref, depth } of frontier) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      followed++;
      if (!snapshotFiles.has(ref)) {
        const msg = `${absent.has(ref) ? "reference absent upstream at the pin" : "dangling reference"} (depth ${depth}): ${ref}`;
        if (depth === 1 && !absent.has(ref)) problems.push(msg);
        else warnings.push(msg);
        continue;
      }
      const text = fs.readFileSync(path.join(L.snapshot, ...ref.split("/")), "utf8");
      if (depth === 1 && !/\/workflows\/[^/]+\.md$/.test(ref)) verbTexts.push(text);
      if (depth < MAX_DEPTH) next.push(...extractRefs(text).map((r) => ({ ref: r, depth: depth + 1 })));
    }
    frontier = next;
  }
  const verbs = new Set(verbTexts.flatMap((t) => scanVerbs(t, known)));
  for (const v of [...verbs].sort()) if (!known.has(v)) problems.push(`unmapped gsd-tools verb "${v}" (add a verb-table row with a reason)`);
  return { problems, warnings, references: followed, verbs: verbs.size, verbose };
}

// Kit-owned namespaces: every file there must be in the inventory. `.agents/agents` also holds project agents
// (ADPT, D-109), so only the kit's gsd-* names are enforced there.
const KIT_ONLY = [
  { dir: ".agents/gsd/generated", owned: () => true },
  { dir: ".agents/gsd/overlays", owned: () => true },
  { dir: ".agents/agents", owned: (name) => name.startsWith("gsd-") },
];

const agentIncludes = (text) => {
  const { head } = splitFrontMatter(text);
  const block = /^include:\s*\n((?:[ \t]+-[^\n]*\n?)*)/m.exec(head)?.[1] ?? "";
  return [...block.matchAll(/^[ \t]+-\s*(.+?)\s*$/gm)].map((m) => m[1].replace(/^["']|["']$/g, ""));
};

// GSDC-53: every inventory entry exists with its type (generated or not), every agent include exists, and the
// kit-owned namespaces hold nothing unlisted.
function installedProblems(L, fresh) {
  const problems = [];
  const listed = new Set(L.inventory.entries.map((e) => e.installed));
  for (const e of L.inventory.entries) {
    const isDir = e.installed.endsWith("/");
    const rel = e.installed.replace(/\/$/, "");
    if (!safeRel(rel)) {
      problems.push(`inventory entry outside the install root: ${e.installed}`);
      continue;
    }
    const st = fs.statSync(L.abs(rel), { throwIfNoEntry: false });
    const present = st && (isDir ? st.isDirectory() : st.isFile());
    if (!present && !fresh.has(e.installed)) problems.push(`installed GSD method file missing: ${e.installed}`);
    if (e.kind !== "agent" || (!present && !fresh.has(e.installed))) continue;
    const includes = fresh.has(e.installed) ? (e.include ?? []) : agentIncludes(fs.readFileSync(L.abs(rel), "utf8"));
    for (const inc of includes) if (!safeRel(inc) || !fs.statSync(L.abs(inc), { throwIfNoEntry: false })?.isFile()) problems.push(`agent include missing: ${e.installed} -> ${inc}`);
  }
  for (const { dir, owned } of KIT_ONLY) {
    const walk = (abs) => {
      for (const d of fs.existsSync(abs) ? fs.readdirSync(abs, { withFileTypes: true }) : []) {
        const p = path.join(abs, d.name);
        if (d.isDirectory()) walk(p);
        else {
          const rel = toSlash(path.relative(L.target, p));
          if (!listed.has(rel) && owned(d.name)) problems.push(`installed GSD method file not in the inventory: ${rel}`);
        }
      }
    };
    walk(L.abs(dir));
  }
  return problems;
}

function diffStat(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const stat = { added: 0, changed: 0, removed: 0 };
  for (const k of keys) {
    if (!(k in before)) stat.added++;
    else if (!(k in after)) stat.removed++;
    else if (before[k] !== after[k]) stat.changed++;
  }
  return stat;
}

function generatedHashes(L) {
  const out = {};
  for (const e of L.inventory.entries) {
    if (e.source === "kit-authored" || !e.transformations.length) continue;
    const f = L.abs(e.installed);
    if (fs.existsSync(f)) out[e.installed] = textDigest(fs.readFileSync(f, "utf8"));
  }
  return out;
}

function optionsOf(args, names) {
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith("--") ? args[i].slice(2) : null;
    if (key === "verbose") opts.verbose = true;
    else if (names.includes(key) && i + 1 < args.length) opts[key] = args[++i];
    else throw fail(`unknown argument ${args[i]}`);
  }
  return opts;
}

export async function checkTarget(target) {
  const L = layout(target);
  const { VERBS } = await import("./commands.mjs");
  return check(L, new Set([...Object.keys(VERBS), ...Object.keys(L.inventory.extra_verbs ?? {})]));
}

export async function upstreamVerb(g, sub, args) {
  const opts = optionsOf(args, ["from", "commit", "target"]);
  const L = layout(path.resolve(g.harnessRoot, opts.target ?? INSTALL_ROOT));
  const { VERBS } = await import("./commands.mjs");
  const known = new Set([...Object.keys(VERBS), ...Object.keys(L.inventory.extra_verbs ?? {})]);
  const report = (r) => {
    for (const p of r.problems) g.out(`problem: ${p}`);
    if (r.verbose) for (const w of r.warnings) g.out(`warning: ${w}`);
    g.out(`check: ${r.problems.length} problems, ${r.warnings.length} warnings; ${r.references} references followed, ${r.verbs} verbs mapped`);
  };
  if (sub === "vendor") {
    if (!opts.from) throw fail("upstream vendor needs --from <clone>");
    return done(vendor(L, path.resolve(opts.from), opts.commit));
  }
  if (sub === "build") return done(build(L));
  if (sub === "check") {
    const r = check(L, known, opts);
    report(r);
    return done({ status: r.problems.length ? "problems" : "ok", problems: r.problems, warnings: r.warnings.length, references: r.references, verbs: r.verbs }, r.problems.length ? 1 : 0);
  }
  if (!opts.from || !opts.commit) throw fail("upstream bump needs --from <clone> --commit <sha>");
  const before = { snapshot: { ...(readPin(L)?.files ?? {}) }, generated: generatedHashes(L) };
  const pin = readPin(L) ?? { repo: "open-gsd/gsd-core" };
  writeJsonAtomic(L.pinFile, { ...pin, commit: opts.commit });
  vendor(L, path.resolve(opts.from), opts.commit);
  const built = build(L);
  const r = check(L, known, opts);
  report(r);
  const stat = { snapshot: diffStat(before.snapshot, readPin(L).files), generated: diffStat(before.generated, generatedHashes(L)) };
  g.out(`snapshot: +${stat.snapshot.added} ~${stat.snapshot.changed} -${stat.snapshot.removed}; generated: +${stat.generated.added} ~${stat.generated.changed} -${stat.generated.removed}`);
  return done({ status: r.problems.length ? "problems" : "ok", commit: opts.commit, written: built.written, diff: stat, problems: r.problems }, r.problems.length ? 1 : 0);
}
