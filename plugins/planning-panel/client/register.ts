// Client registrations (PANL-02), separate from the components so they are checked offline with a fake host.
import type { PluginClientContext, PluginSurfaceProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";

export const SURFACE_ID = "planning";
export const PANEL_ID = "planning";
const ICON = "ListTree";

type Host = Pick<PluginClientContext, "addSurface" | "addSidebarItem" | "addWorkspacePanel" | "addCommandCenterItem">;

export function register(client: Host, Surface: ComponentType<PluginSurfaceProps>, Panel: ComponentType<PluginWorkspacePanelProps>) {
  const offs = [
    client.addSurface(SURFACE_ID, Surface),
    client.addSidebarItem({ id: SURFACE_ID, title: "Planning", icon: ICON, surface: SURFACE_ID }),
    client.addWorkspacePanel({ id: PANEL_ID, title: "Planning", icon: ICON, context: "workspace", Component: Panel }),
    client.addCommandCenterItem({
      id: "open-planning",
      title: "Open Planning",
      icon: ICON,
      keywords: ["gsd", "phases", "plans", "roadmap", ".planning"],
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
  ];
  return () => {
    for (const off of offs) void off();
  };
}
