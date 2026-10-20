import type { PluginServerContext } from "@getpaseo/plugin/server";
import { ActivityCache } from "./server/activity.ts";
import { EventLog, recordLifecycle } from "./server/events.ts";
import { FileLedger } from "./server/files.ts";
import { RotateResolver } from "./server/rotate.ts";
import { SnapshotBuilder } from "./server/snapshot.ts";
import { WaveLinker } from "./server/wave-link.ts";
import { agentDetailRpc, swarmSnapshotRpc } from "./shared/swarm.ts";

// Read-only observer (PANL-05): handlers list agents and read timelines and run records; nothing is written.
export default function contribute(server: PluginServerContext) {
  const events = new EventLog();
  const files = new FileLedger();
  const builder = new SnapshotBuilder({
    activity: new ActivityCache(files),
    events,
    files,
    rotate: new RotateResolver(),
    waves: new WaveLinker(),
  });
  const stopRecording = recordLifecycle(server, events);
  server.handle(swarmSnapshotRpc, (input, { paseo }) => builder.build(paseo, input));
  server.handle(agentDetailRpc, ({ agentId }, { paseo }) => builder.detail(paseo, agentId));
  return () => stopRecording();
}
