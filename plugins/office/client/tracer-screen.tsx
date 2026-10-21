// Tracer screen (OFFC-08, OFFC-09): asks office.sprites once per key and shows the PNG data URI at its natural pixel size.
import { useRpc, type PluginScreenProps, type PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { ZOOM_CANDIDATES } from "../shared/art-types.ts";
import { spriteKey, spritesRpc, type SpritesInput, type SpritesOutput } from "../shared/sprites-rpc.ts";
import { SCREEN_ID } from "./register.ts";

type Loaded = { ok: true; source: { uri: string }; w: number; h: number } | { ok: false; code: string };

const TRACER_KEY = spriteKey({ kind: "ruler", seed: "tracer", poses: [], scale: ZOOM_CANDIDATES[0], tint: 0 });

// One request per key and one stable source object per key, kept across rerenders and remounts.
const requests = new Map<string, Promise<Loaded>>();
const settled = new Map<string, Loaded>();

function toLoaded(out: SpritesOutput): Loaded {
  if (!out.ok) return { ok: false, code: out.code };
  const sprite = out.sprites[0];
  if (!sprite) return { ok: false, code: "internal" };
  if (!sprite.ok) return { ok: false, code: sprite.code };
  return { ok: true, source: { uri: sprite.uri }, w: sprite.w, h: sprite.h };
}

function load(key: string, call: (input: SpritesInput) => Promise<SpritesOutput>): Promise<Loaded> {
  let pending = requests.get(key);
  if (!pending) {
    pending = call({ keys: [key] }).then(
      (out) => {
        const loaded = toLoaded(out);
        settled.set(key, loaded);
        return loaded;
      },
      () => {
        requests.delete(key);
        const loaded: Loaded = { ok: false, code: "internal" };
        return loaded;
      },
    );
    requests.set(key, pending);
  }
  return pending;
}

export function TracerScreen({ theme }: PluginScreenProps) {
  const call = useRpc(spritesRpc);
  const [state, setState] = useState<Loaded | null>(settled.get(TRACER_KEY) ?? null);
  useEffect(() => {
    if (state) return;
    let live = true;
    void load(TRACER_KEY, call).then((loaded) => {
      if (live) setState(loaded);
    });
    return () => {
      live = false;
    };
  }, [state]);
  if (!state) return <View />;
  if (!state.ok) return <Text style={{ color: theme.colors.statusDanger }}>{state.code}</Text>;
  return <Image source={state.source} style={{ width: state.w, height: state.h }} />;
}

export function TracerSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return <SidebarRow onPress={() => openScreen({ screenId: SCREEN_ID })} active={currentScreen?.screenId === SCREEN_ID} />;
}
