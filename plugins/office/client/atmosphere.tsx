// Tint cross-fade layer (OFFC-17, D-05): mounts one base tint variant and at most one overlay variant whose opacity is the fraction of the position.
import { Image, View } from "react-native";
import { fadeLayers } from "./daylight.ts";

export interface TintSource {
  readonly uri: string;
}

export interface TintFadeProps {
  sources: readonly (TintSource | null)[];
  position: number;
  width: number;
  height: number;
}

const positive = (n: number): boolean => typeof n === "number" && Number.isFinite(n) && n > 0;

// Keys and test ids use the variant index only, so a variant that moves from overlay to base stays mounted.
export function TintFade({ sources, position, width, height }: TintFadeProps) {
  if (!positive(width) || !positive(height)) return null;
  const plan = fadeLayers(
    position,
    sources.map((s) => s !== null && s !== undefined),
  );
  if (plan.base === null) return null;
  const layer = { position: "absolute", left: 0, top: 0, width, height } as const;
  const base = sources[plan.base];
  const over = plan.over === null ? null : sources[plan.over];
  return (
    <View testID="office-tint" style={{ width, height, pointerEvents: "none" }}>
      {base ? <Image key={`tint-${plan.base}`} testID={`office-tint-${plan.base}`} source={base} style={layer} /> : null}
      {over && plan.over !== null ? <Image key={`tint-${plan.over}`} testID={`office-tint-${plan.over}`} source={over} style={{ ...layer, opacity: plan.overOpacity }} /> : null}
    </View>
  );
}
