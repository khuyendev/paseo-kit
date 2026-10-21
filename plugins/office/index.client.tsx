import type { PluginClientContext } from "@getpaseo/plugin/client";
import { OfficeScreen, OfficeSidebarItem, disposeOfficeCaches } from "./client/office-screen.tsx";
import { register } from "./client/register.ts";

// The one registered screen is the office; the disposer also releases the plugin-lifetime sprite caches.
export default function contribute(client: PluginClientContext) {
  const off = register(client, OfficeScreen, OfficeSidebarItem);
  return () => {
    off();
    disposeOfficeCaches();
  };
}
