import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createSpritesHandler } from "./server/sprites.ts";
import { WaveLinker, createWaveHandler } from "./server/wave-link.ts";
import { spritesRpc } from "./shared/sprites-rpc.ts";
import { waveRpc } from "./shared/wave-rpc.ts";

// Read-only (OFFC-01, OFFC-18): two handlers, office.sprites (enumerated keys) and office.wave (workspace id and run id);
// no lifecycle hook, no timer, no write.
export default function contribute(server: PluginServerContext) {
  const sprites = createSpritesHandler();
  const linker = new WaveLinker();
  const waves = createWaveHandler({ linker });
  server.handle(spritesRpc, (input) => sprites(input));
  server.handle(waveRpc, (input, { paseo }) => waves(input, { paseo }));
  return () => {
    linker.clear();
  };
}
