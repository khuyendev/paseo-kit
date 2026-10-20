// Brain, hub, agent and ghost nodes (PANL-48, PANL-49). Text colours come from theme.colors only.
import { Icon } from "@getpaseo/plugin/client/react-native";
import { Animated, Pressable, Text, View } from "react-native";
import type { FileHold, SwarmAgent } from "../shared/swarm.ts";
import { useAppear, useClocks, useOneShot, useSmooth } from "./anim.ts";
import { clock, shortModel, shortTitle } from "./format.ts";
import { AGENT_LABEL, AGENT_R, type AgentPlace, BRAIN_LABEL, BRAIN_R, type BrainPlace, HUB_LABEL, HUB_R, type HubPlace } from "./geometry.ts";
import { accessibilityLabel, activityLine, hubProgress, overThreshold, waveLine } from "./labels.ts";
import { ACTIVITY_ICON, type Colors, STATE_ICON, STATE_LABEL, activityHue, agentState, stateColor } from "./palette.ts";
import { Ring } from "./ring.tsx";
import { type AppearMode, GHOST_MS, bootDelay } from "./state.ts";


function Badge({ c, text, hue }: { c: Colors; text: string; hue: string }) {
  return (
    <View style={{ paddingHorizontal: 5, borderRadius: 6, backgroundColor: c.surface2, borderWidth: 1, borderColor: hue }}>
      <Text style={{ color: c.foreground, fontSize: 9, fontWeight: "800" }}>{text}</Text>
    </View>
  );
}

function ContextRing({ c, a, size }: { c: Colors; a: SwarmAgent; size: number }) {
  const progress = useSmooth((a.contextPct ?? 0) / 100);
  const hue = overThreshold(a) ? c.statusWarning : stateColor(c, agentState(a));
  return <Ring size={size} thickness={3} progress={progress} hue={hue} track={c.border} />;
}

function Halo({ hue, r }: { hue: string; r: number }) {
  const { pulse } = useClocks();
  const opacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.08, 0.28, 0.08] });
  const scale = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.95, 1.12, 0.95] });
  return <Animated.View pointerEvents="none" style={{ position: "absolute", left: -r, top: -r, width: r * 2, height: r * 2, borderRadius: r, backgroundColor: hue, opacity, transform: [{ scale }] }} />;
}

export function AgentNode(props: { c: Colors; place: AgentPlace; selected: boolean; appear: AppearMode; bootIndex: number; isNew: boolean; nowMs: number; files: FileHold[]; onPress: () => void }) {
  const { c, place, selected } = props;
  const a = place.agent;
  const state = agentState(a);
  const t = useAppear(props.appear !== "none", props.appear === "boot" ? bootDelay(props.bootIndex) : 0, props.appear === "spawn");
  const glyph = state === "working" && a.activity ? ACTIVITY_ICON[a.activity.kind] : STATE_ICON[state];
  const glyphHue = state === "working" && a.activity ? activityHue(c, a.activity.kind) : stateColor(c, state);
  const title = shortTitle(a.title, place.swarm);
  return (
    <Animated.View style={{ position: "absolute", left: place.x, top: place.y, opacity: t, transform: [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] }) }] }}>
      {state === "working" ? <Halo hue={c.statusSuccess} r={AGENT_R + 10} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel(a)}
        onPress={props.onPress}
        style={{ position: "absolute", left: -AGENT_R, top: -AGENT_R, width: AGENT_R * 2, height: AGENT_R * 2, alignItems: "center", justifyContent: "center", opacity: state === "sleep" ? 0.6 : 1 }}
      >
        <View style={{ position: "absolute" }}>
          <ContextRing c={c} a={a} size={AGENT_R * 2} />
        </View>
        <View style={{ width: AGENT_R * 2 - 10, height: AGENT_R * 2 - 10, borderRadius: AGENT_R, backgroundColor: selected ? c.surface2 : c.surface1, borderWidth: selected ? 2 : 1, borderColor: selected ? c.foreground : c.border, alignItems: "center", justifyContent: "center" }}>
          <Icon name={glyph} size={18} color={glyphHue} />
        </View>
      </Pressable>
      <View pointerEvents="none" style={{ position: "absolute", left: AGENT_R - 8, top: -AGENT_R - 6, flexDirection: "row", gap: 3 }}>
        {title.badge ? <Badge c={c} text={title.badge} hue={c.border} /> : null}
        {props.isNew ? <Badge c={c} text="NEW" hue={c.accent} /> : null}
        {state === "waiting" ? <Badge c={c} text="!" hue={c.statusWarning} /> : null}
        {state === "error" ? <Badge c={c} text="ERR" hue={c.statusDanger} /> : null}
        {a.contextPct !== null ? <Badge c={c} text={`${a.contextPct}%`} hue={overThreshold(a) ? c.statusWarning : c.border} /> : null}
      </View>
      <View pointerEvents="none" style={{ position: "absolute", left: -AGENT_LABEL.w / 2, top: AGENT_R + 6, width: AGENT_LABEL.w, alignItems: "center", gap: 2 }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, fontWeight: "700" }}>
          {title.label}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10 }}>
          {state === "working" && a.turnStartedAt ? `${clock(props.nowMs - Date.parse(a.turnStartedAt))} · ` : ""}
          {activityLine(a)}
        </Text>
        <View style={{ flexDirection: "row", gap: 3 }}>
          {props.files.slice(0, 2).map((f) => (
            <View key={f.path} style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 4, borderRadius: 4, borderWidth: 1, borderColor: f.writers >= 2 ? c.statusDanger : c.border }}>
              {f.writers >= 2 ? <Icon name="TriangleAlert" size={9} color={c.statusDanger} /> : null}
              <Text numberOfLines={1} style={{ color: f.writers >= 2 ? c.statusDanger : c.foregroundMuted, fontSize: 9, maxWidth: 64 }}>
                {f.name}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

export function HubNode({ c, place, selected, appear, onPress }: { c: Colors; place: HubPlace; selected: boolean; appear: AppearMode; onPress: () => void }) {
  const g = place.group;
  const t = useAppear(appear !== "none");
  const progress = useSmooth(hubProgress(g));
  const counts = (s: string) => g.agents.filter((a) => agentState(a) === s).length;
  return (
    <Animated.View style={{ position: "absolute", left: place.x, top: place.y, opacity: t }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`swarm ${g.name}, ${g.agents.length} agents, ${waveLine(g.wave)}`}
        onPress={onPress}
        style={{ position: "absolute", left: -HUB_R, top: -HUB_R, width: HUB_R * 2, height: HUB_R * 2, alignItems: "center", justifyContent: "center" }}
      >
        <View style={{ position: "absolute" }}>
          <Ring size={HUB_R * 2} thickness={4} progress={progress} hue={g.wave ? c.accent : c.statusSuccess} track={c.border} />
        </View>
        <View style={{ width: HUB_R * 2 - 14, height: HUB_R * 2 - 14, borderRadius: HUB_R, backgroundColor: selected ? c.surface2 : c.surface1, borderWidth: 1, borderColor: selected ? c.foreground : c.border, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: c.foreground, fontSize: 16, fontWeight: "900" }}>{g.agents.length}</Text>
        </View>
      </Pressable>
      <View pointerEvents="none" style={{ position: "absolute", left: -HUB_LABEL.w / 2, top: HUB_R + 4, width: HUB_LABEL.w, alignItems: "center" }}>
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 12, fontWeight: "800" }}>
          {g.name}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10 }}>
          {`${counts("working")} running · ${counts("sleep")} sleep${counts("waiting") ? ` · ${counts("waiting")} waiting` : ""}${counts("error") ? ` · ${counts("error")} error` : ""}`}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10 }}>
          {waveLine(g.wave)}
        </Text>
      </View>
    </Animated.View>
  );
}

export function BrainNode({ c, place, selected, appear, nowMs, onPress }: { c: Colors; place: BrainPlace; selected: boolean; appear: AppearMode; nowMs: number; onPress: () => void }) {
  const a = place.brain.agent;
  const t = useAppear(appear !== "none");
  const members = place.brain.groups.flatMap((g) => g.agents);
  const state = a ? agentState(a) : "sleep";
  return (
    <Animated.View style={{ position: "absolute", left: place.x, top: place.y, opacity: t }}>
      {a && state === "working" ? <Halo hue={c.statusSuccess} r={BRAIN_R + 14} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={a ? accessibilityLabel(a) : "orphan subagents"}
        onPress={onPress}
        style={{ position: "absolute", left: -BRAIN_R, top: -BRAIN_R, width: BRAIN_R * 2, height: BRAIN_R * 2, alignItems: "center", justifyContent: "center" }}
      >
        {a ? (
          <View style={{ position: "absolute" }}>
            <ContextRing c={c} a={a} size={BRAIN_R * 2} />
          </View>
        ) : null}
        <View style={{ width: BRAIN_R * 2 - 16, height: BRAIN_R * 2 - 16, borderRadius: BRAIN_R, backgroundColor: selected ? c.surface2 : c.surface1, borderWidth: 1, borderStyle: a ? "solid" : "dashed", borderColor: selected ? c.foreground : c.border, alignItems: "center", justifyContent: "center" }}>
          <Icon name={a ? "BrainCircuit" : "Ghost"} size={30} color={a ? stateColor(c, state) : c.foregroundMuted} />
          {a?.contextPct !== null && a ? <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{`ctx ${a.contextPct}%`}</Text> : null}
        </View>
      </Pressable>
      <View pointerEvents="none" style={{ position: "absolute", left: -BRAIN_LABEL.w / 2, top: BRAIN_R + 6, width: BRAIN_LABEL.w, alignItems: "center", gap: 2 }}>
        {a ? (
          <>
            {a.project ? <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10, fontWeight: "700" }}>{a.project}</Text> : null}
            <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 13, fontWeight: "800" }}>
              {a.title}
            </Text>
            <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10 }}>
              {STATE_LABEL[state]}
              {a.turnStartedAt ? ` · ${clock(nowMs - Date.parse(a.turnStartedAt))}` : ""} · {shortModel(a.model)}
            </Text>
          </>
        ) : (
          <Text style={{ color: c.foreground, fontSize: 13, fontWeight: "900", letterSpacing: 1 }}>ORPHANS</Text>
        )}
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 10 }}>
          {`${place.brain.groups.length} swarms · ${members.length} agents`}
        </Text>
      </View>
    </Animated.View>
  );
}

export interface Ghost {
  agent: SwarmAgent;
  x: number;
  y: number;
  hubX: number;
  hubY: number;
  reason: "archived" | "gone";
}

// A drawn agent that vanished drifts into its hub once, tagged archived or gone (PANL-49).
export function GhostNode({ c, ghost, onDone }: { c: Colors; ghost: Ghost; onDone: () => void }) {
  const t = useOneShot(GHOST_MS, onDone);
  const tx = t.interpolate({ inputRange: [0, 1], outputRange: [ghost.x, ghost.hubX] });
  const ty = t.interpolate({ inputRange: [0, 1], outputRange: [ghost.y, ghost.hubY] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <Animated.View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, opacity, transform: [{ translateX: tx }, { translateY: ty }] }}>
      <View style={{ position: "absolute", left: -AGENT_R, top: -AGENT_R, width: AGENT_R * 2, height: AGENT_R * 2, borderRadius: AGENT_R, borderWidth: 1, borderStyle: "dashed", borderColor: c.border, alignItems: "center", justifyContent: "center" }}>
        <Icon name={ghost.reason === "archived" ? "Archive" : "Ghost"} size={16} color={c.foregroundMuted} />
      </View>
      <Text style={{ position: "absolute", left: -40, top: AGENT_R + 4, width: 80, textAlign: "center", color: c.foregroundMuted, fontSize: 10 }}>{ghost.reason}</Text>
    </Animated.View>
  );
}
