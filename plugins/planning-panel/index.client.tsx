import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PlanningPanel } from "./client/panel.tsx";
import { register } from "./client/register.ts";
import { PlanningSurface } from "./client/sidebar.tsx";

export default function contribute(client: PluginClientContext) {
  return register(client, PlanningSurface, PlanningPanel);
}
