// Fake Paseo CLI: logs args; exits with $FAKE_PASEO_EXIT.
import fs from "node:fs";

fs.appendFileSync(process.env.FAKE_PASEO_LOG, `${JSON.stringify({ args: process.argv.slice(2) })}\n`);
if (process.env.FAKE_PASEO_EXIT && process.env.FAKE_PASEO_EXIT !== "0") process.stderr.write("daemon unreachable\n");
process.exitCode = Number(process.env.FAKE_PASEO_EXIT ?? 0);
