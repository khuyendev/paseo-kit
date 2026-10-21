// Client registrations (OFFC-01), separate from the components so Node tests can import them without a host.
import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import { STRINGS } from "./strings.ts";

export const SCREEN_ID = "office";
export const SCREEN_TITLE = STRINGS.sidebarTitle;

export function register(
  client: Pick<PluginClientContext, "addScreen" | "addSidebarHeaderItem">,
  Screen: ComponentType<PluginScreenProps>,
  SidebarItem: ComponentType<PluginSidebarItemProps>,
) {
  const offs = [
    client.addScreen({ id: SCREEN_ID, title: SCREEN_TITLE, Component: Screen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: SCREEN_TITLE, Component: SidebarItem }),
  ];
  return () => {
    for (const off of offs) void off();
  };
}
