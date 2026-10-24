// ph command module of the adapter (M12): `ph harness lint`.
import { UsageError } from "../lib/cli.mjs";
import { findingLine, lintProject } from "./lint.mjs";
import { runCommandProbes, runTestFileProbe } from "./lint-probes.mjs";
import { loadConfigLenient } from "../config.mjs";

export const commands = [
  {
    name: "harness",
    summary: "lint the project adapter and the skills, agents and scripts the harness generated",
    usage: "ph harness lint [--all] [--no-probes]",
    options: { all: "bool", "no-probes": "bool" },
    // The linter reports an invalid overlay as a finding and goes on with the kit defaults.
    config: "none",
    run: async (ctx) => {
      if (ctx.args.length !== 1 || ctx.args[0] !== "lint") throw new UsageError("usage: ph harness lint [--all] [--no-probes]");
      const { findings, checked } = lintProject(ctx.root, { all: Boolean(ctx.opts.all) });
      // Kit feedback 81: each adapter.command_probes argv runs once (read-only, short timeout); a rejected one fails the lint.
      if (!ctx.opts["no-probes"]) {
        const cfg = loadConfigLenient(ctx.root).cfg;
        findings.push(...(await runCommandProbes(ctx.root, cfg, { env: ctx.env })));
        findings.push(...(await runTestFileProbe(ctx.root, cfg, { env: ctx.env })));
      }
      for (const f of findings) ctx.out(findingLine(f));
      const failed = findings.filter((f) => f.level === "fail").length;
      ctx.out(`lint: ${failed} failed, ${findings.length - failed} warnings (${checked} files checked)`);
      return failed ? 2 : 0;
    },
  },
];
