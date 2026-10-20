// ph command module of the adapter (M12): `ph harness lint`.
import { UsageError } from "../lib/cli.mjs";
import { findingLine, lintProject } from "./lint.mjs";

export const commands = [
  {
    name: "harness",
    summary: "lint the project adapter and the skills, agents and scripts the harness generated",
    usage: "ph harness lint [--all]",
    options: { all: "bool" },
    // The linter reports an invalid overlay as a finding and goes on with the kit defaults.
    config: "none",
    run: (ctx) => {
      if (ctx.args.length !== 1 || ctx.args[0] !== "lint") throw new UsageError("usage: ph harness lint [--all]");
      const { findings, checked } = lintProject(ctx.root, { all: Boolean(ctx.opts.all) });
      for (const f of findings) ctx.out(findingLine(f));
      const failed = findings.filter((f) => f.level === "fail").length;
      ctx.out(`lint: ${failed} failed, ${findings.length - failed} warnings (${checked} files checked)`);
      return failed ? 2 : 0;
    },
  },
];
