import type { PluginClientContext } from "@getpaseo/plugin/client";
import { register } from "./client/register.ts";
import { TracerScreen, TracerSidebarItem } from "./client/tracer-screen.tsx";

export default function contribute(client: PluginClientContext) {
  return register(client, TracerScreen, TracerSidebarItem);
}
