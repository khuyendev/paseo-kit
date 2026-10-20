import type { PluginTheme } from "@getpaseo/plugin";
import type { Tone } from "../shared/planning.ts";

export type Colors = PluginTheme["colors"];

// "#fff", 0.5 -> "rgba(255, 255, 255, 0.500)"; anything that is not a hex colour is returned unchanged (PANL-22).
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return color;
  let digits = m[1];
  if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
  if (digits.length !== 6 && digits.length !== 8) return color;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16));
  const base = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
  return `rgba(${r}, ${g}, ${b}, ${(alpha * base).toFixed(3)})`;
}

export function toneColor(colors: Colors, tone: Tone | "foreground" | "onAccent"): string {
  switch (tone) {
    case "muted":
      return colors.foregroundMuted;
    case "accent":
      return colors.accent;
    case "success":
      return colors.statusSuccess;
    case "warning":
      return colors.statusWarning;
    case "danger":
      return colors.statusDanger;
    case "onAccent":
      return colors.accentForeground;
    default:
      return colors.foreground;
  }
}
