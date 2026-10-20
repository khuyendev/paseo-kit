import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PlanningService } from "./server/service.ts";
import { planningBoardRpc, planningFileRpc, planningIndexRpc, planningPlanRpc } from "./shared/planning.ts";

// Read-only observer (PANL-05): `.planning/` is read with node:fs; nothing is written, spawned or sent.
export default function contribute(server: PluginServerContext) {
  const service = new PlanningService();
  server.handle(planningIndexRpc, (input, { paseo }) => service.index(paseo, input));
  server.handle(planningBoardRpc, (input, { paseo }) => service.board(paseo, input));
  server.handle(planningPlanRpc, (input, { paseo }) => service.plan(paseo, input));
  server.handle(planningFileRpc, (input, { paseo }) => service.file(paseo, input));
  return () => {};
}
