import type { PluginClientContext } from "@getpaseo/plugin/client";
import { register } from "./client/register.ts";
import { SwarmSurface } from "./client/swarm-surface.tsx";

export default function contribute(client: PluginClientContext) {
  return register(client, SwarmSurface);
}
