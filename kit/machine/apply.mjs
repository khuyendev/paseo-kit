// `machine apply`: every gate and the whole patch in memory first, then backup, pending-reload marker, atomic write, links,
// reload, check (MACH-07..12, MACH-15, MACH-16, MACH-18). Never starts, stops or restarts the daemon.
import fs from "node:fs";
import { writeJsonAtomic } from "../../ship/.agents/harness/lib/io.mjs";
import { claudeGate, nodeGate, runCheck } from "./check.mjs";
import { loadInputs, readLive, Fail } from "./context.mjs";
import { npmCi, paseoReload } from "./external.mjs";
import { applyLinks, linkDirs, linkStates, readRecord } from "./links.mjs";
import { kitPlugins, needsDeps, patchPlugins } from "./plugins.mjs";
import { patchProviders } from "./providers.mjs";
import { secretResolver } from "./template.mjs";

const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;

// <config>.bak-<YYYYMMDD-HHMMSS>-kit (UTC); a same-second collision gets -2, -3, ... (MACH-11).
function backupPath(file) {
  const base = `${file}.bak-${stamp(new Date())}-kit`;
  let candidate = base;
  for (let n = 2; fs.existsSync(candidate); n++) candidate = `${base}-${n}`;
  return candidate;
}

export async function runApply(ctx, opts) {
  const node = nodeGate();
  if (!node.ok) throw new Fail(node.text);
  const { cfg, tpl } = loadInputs(ctx);
  const claude = claudeGate(ctx, tpl);
  if (!claude.ok) throw new Fail(claude.text);
  const live = readLive(ctx);
  const { next, changes } = patchProviders(live, tpl, cfg, { home: ctx.home, secret: secretResolver(live, ctx.env) });
  let plugins = { changes: [], conflicts: [], registered: [] };
  if (opts.enablePlugins) {
    const found = kitPlugins(ctx.pluginsDir);
    const broken = found.find((p) => p.error);
    if (broken) throw new Fail(`kit Paseo plugin folder ${broken.folder}: ${broken.error}`);
    plugins = patchPlugins(next, found);
  }
  const linkMode = opts.link ? "link" : opts.unlink ? "unlink" : null;
  const record = linkMode ? readRecord(ctx.linksRecord) : null;
  const states = linkMode ? linkStates(linkDirs(tpl, ctx.home), record, ctx.skillDir) : [];

  let problems = 0;
  const allChanges = [...changes, ...plugins.changes];
  const written = allChanges.length > 0 && JSON.stringify(next) !== JSON.stringify(live);
  if (written) {
    const backup = backupPath(ctx.paseoConfig);
    fs.copyFileSync(ctx.paseoConfig, backup);
    // The marker goes down before the write, so an abrupt exit after the write leaves it behind (G176).
    writeJsonAtomic(ctx.reloadPending, { version: 1, config: ctx.paseoConfig, backup });
    try {
      writeJsonAtomic(ctx.paseoConfig, next);
    } catch (e) {
      fs.rmSync(ctx.reloadPending, { force: true });
      throw e;
    }
    for (const change of allChanges) ctx.out(`paseo: ${change}`);
    ctx.out(`paseo: backup ${backup}`);
  } else ctx.out("paseo: every template provider, model and policy entry is present");
  for (const line of plugins.conflicts) {
    problems++;
    ctx.out(line);
  }
  for (const p of plugins.registered) {
    if (needsDeps(p)) {
      const r = await npmCi(p.dir, ctx.env);
      if (!r.ok) {
        problems++;
        ctx.out(`failed plugin ${p.id}: npm ci ${r.reason}`);
        continue;
      }
      ctx.out(`paseo: plugin ${p.id}: npm ci done`);
    }
    ctx.out(`paseo: to load it now: paseo plugin reload ${p.id}`);
  }
  if (linkMode) {
    const { lines, failures } = applyLinks(states, { record, recordFile: ctx.linksRecord, target: ctx.skillDir, mode: linkMode });
    for (const line of lines) ctx.out(line);
    problems += failures;
  }
  // A marker left by an earlier write whose reload never finished makes this run reload again (G176).
  const reload = written || fs.existsSync(ctx.reloadPending);
  if (reload && !opts.noReload) {
    const r = await paseoReload(ctx.env);
    if (r.ok) {
      fs.rmSync(ctx.reloadPending, { force: true });
      ctx.out("paseo: configuration reloaded (paseo reload; no daemon restart)");
    } else {
      problems++;
      ctx.out(`paseo reload failed (${r.reason}); run it yourself: paseo reload`);
    }
  } else if (reload) {
    fs.rmSync(ctx.reloadPending, { force: true });
    ctx.out("paseo: reload skipped (--no-reload); run paseo reload to load the change");
  }
  ctx.out("--- check");
  const checked = runCheck(ctx, { enablePlugins: opts.enablePlugins });
  return problems || checked ? 2 : 0;
}
