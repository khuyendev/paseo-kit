import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createSpritesHandler } from "./server/sprites.ts";
import { spritesRpc } from "./shared/sprites-rpc.ts";

// Read-only (OFFC-01): the only handler draws sprites from enumerated keys; no Paseo call, file read or write.
export default function contribute(server: PluginServerContext) {
  const handler = createSpritesHandler();
  server.handle(spritesRpc, (input) => handler(input));
  return () => {};
}
