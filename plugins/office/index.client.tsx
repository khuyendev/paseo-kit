import type { PluginClientContext, PluginScreenProps } from "@getpaseo/plugin/client";
import { register } from "./client/register.ts";
import { SPIKE_VIEW_PARAM } from "./client/spike-hud.ts";
import { SpikeScreen, SpikeSidebarItem } from "./client/spike-screen.tsx";
import { TracerScreen } from "./client/tracer-screen.tsx";

// The one registered screen: the tracer without params, the spike with view=spike (07-11 replaces it with the real office).
export function OfficeEntry(props: PluginScreenProps) {
  return props.params.view === SPIKE_VIEW_PARAM ? <SpikeScreen {...props} /> : <TracerScreen {...props} />;
}

export default function contribute(client: PluginClientContext) {
  return register(client, OfficeEntry, SpikeSidebarItem);
}
