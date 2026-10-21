// No upstream: written for the agent states of the office.
// Character overlays: the glyph bubble above the head (activity, needs you, waiting on shell, celebration) and the name tag under the feet
// with the provider chip. Stateless but for the blink, one Animated loop per alert that stops on unmount. Text comes from the strings table
// or from the generated name, never from an agent value in a style.
import { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Text, View } from "react-native";
import { BUBBLE_BLINK_MIN, BUBBLE_BLINK_MS, BUBBLE_FONT_PX, BUBBLE_PAD_PX, BUBBLE_RISE_PX, CHIP_PX, NAME_FONT_PX, NAME_WIDTH_PX } from "./limits-atmosphere.ts";
import type { ProviderChip } from "./names.ts";
import type { SceneColors } from "./room.tsx";
import { text, type StringKey } from "./strings.ts";

const NATIVE_DRIVER = Platform.OS !== "web";

export function MoodBubble(props: { glyphs: readonly StringKey[]; blink: boolean; soft: boolean; frameW: number; colors: SceneColors; testID: string }) {
  const { glyphs, blink, soft, frameW, colors, testID } = props;
  const value = useRef<Animated.Value | null>(null);
  if (value.current === null) value.current = new Animated.Value(1);
  const opacity = value.current;
  useEffect(() => {
    if (!blink) {
      opacity.setValue(1);
      return undefined;
    }
    const half = (to: number) => Animated.timing(opacity, { toValue: to, duration: BUBBLE_BLINK_MS, easing: Easing.linear, useNativeDriver: NATIVE_DRIVER });
    const loop = Animated.loop(Animated.sequence([half(BUBBLE_BLINK_MIN), half(1)]));
    loop.start();
    return () => loop.stop();
  }, [blink]);
  if (glyphs.length === 0) return null;
  const background = blink ? colors.statusWarning : colors.surface1;
  const border = blink ? colors.statusWarning : soft ? colors.foregroundMuted : colors.border;
  return (
    <Animated.View
      testID={testID}
      style={{ position: "absolute", left: 0, top: -BUBBLE_RISE_PX, width: frameW, alignItems: "center", opacity, pointerEvents: "none" } as never}
    >
      <View testID={`${testID}-box`} style={{ flexDirection: "row", gap: 1, paddingHorizontal: BUBBLE_PAD_PX, borderRadius: 6, borderWidth: 1, borderColor: border, backgroundColor: background }}>
        {glyphs.map((key, index) => (
          <Text key={index} style={{ color: blink ? colors.surface1 : soft ? colors.foregroundMuted : colors.foreground, fontSize: BUBBLE_FONT_PX, fontWeight: "800" }}>
            {text(key)}
          </Text>
        ))}
      </View>
    </Animated.View>
  );
}

export function NameTag(props: { shown: string; chip: ProviderChip | null; frameW: number; frameH: number; colors: SceneColors; testID: string }) {
  const { shown, chip, frameW, frameH, colors, testID } = props;
  return (
    <View testID={testID} style={{ position: "absolute", left: frameW / 2 - NAME_WIDTH_PX / 2, top: frameH, width: NAME_WIDTH_PX, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 2, pointerEvents: "none" }}>
      {chip !== null ? (
        <View style={{ width: CHIP_PX, height: CHIP_PX, borderRadius: 2, alignItems: "center", justifyContent: "center", backgroundColor: chip.color }}>
          <Text style={{ color: colors.surface1, fontSize: NAME_FONT_PX - 2, fontWeight: "800" }}>{chip.letter}</Text>
        </View>
      ) : null}
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: NAME_FONT_PX, flexShrink: 1 }}>
        {shown}
      </Text>
    </View>
  );
}
