// Client registrations (PANL-02), separate from the components so they are checked offline with a fake host.
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";

export const SURFACE_ID = "swarm";

export function register(client: Pick<PluginClientContext, "addSurface" | "addSidebarItem">, Surface: ComponentType<PluginSurfaceProps>) {
  const offs = [
    client.addSurface(SURFACE_ID, Surface),
    client.addSidebarItem({ id: SURFACE_ID, title: "Swarm", icon: "Orbit", surface: SURFACE_ID }),
  ];
  return () => {
    for (const off of offs) void off();
  };
}
