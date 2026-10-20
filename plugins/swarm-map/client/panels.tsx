// Side panel: inspector, activity feed and legend (PANL-45, PANL-52, PANL-53). Read-only: the only actions are
// selection and copying an id (PANL-05).
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, copyText } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Animated, Pressable, Text, View } from "react-native";
import type { FileHold, SwarmAgent, SwarmEvent, SwarmGroup } from "../shared/swarm.ts";
import { agentDetailRpc } from "../shared/swarm.ts";
import { useAppear } from "./anim.ts";
import { ago, clip, clock, shortModel, tokens } from "./format.ts";
import { waveLine } from "./labels.ts";
import { ACTIVITY_ICON, type Colors, EVENT_ICON, LEGEND, STATE_LABEL, activityHue, agentState, eventHue, stateColor } from "./palette.ts";
import { DETAIL_POLL_MS, eventText } from "./state.ts";

export type InspectorTarget = { agent: SwarmAgent; files: FileHold[] } | { group: SwarmGroup };

function Card({ c, title, right, children }: { c: Colors; title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <View style={{ gap: 6, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: c.foregroundMuted, fontSize: 11, fontWeight: "800", letterSpacing: 0.8 }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function Row({ c, label, value }: { c: Colors; label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 8 }}>
      <Text style={{ color: c.foregroundMuted, fontSize: 11, width: 70 }}>{label}</Text>
      <Text selectable style={{ color: c.foreground, fontSize: 11, flex: 1 }}>
        {value}
      </Text>
    </View>
  );
}

function SmallButton({ c, icon, label, onPress }: { c: Colors; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ padding: 4, borderRadius: 6 }}>
      <Icon name={icon} size={14} color={c.foregroundMuted} />
    </Pressable>
  );
}

function AgentInspector({ c, agent, files, nowMs, onClose }: { c: Colors; agent: SwarmAgent; files: FileHold[]; nowMs: number; onClose: () => void }) {
  const detailRpc = useRpc(agentDetailRpc);
  const q = useQuery({ queryKey: ["swarm-agent-detail", agent.id], queryFn: () => detailRpc({ agentId: agent.id }), refetchInterval: DETAIL_POLL_MS });
  const state = agentState(agent);
  const d = q.data;
  return (
    <Card
      c={c}
      title={agent.title}
      right={
        <View style={{ flexDirection: "row" }}>
          <SmallButton c={c} icon="Copy" label="Copy agent id" onPress={() => void copyText(agent.id)} />
          <SmallButton c={c} icon="X" label="Close inspector" onPress={onClose} />
        </View>
      }
    >
      <Row c={c} label="state" value={`${STATE_LABEL[state]}${agent.turnStartedAt ? ` · ${clock(nowMs - Date.parse(agent.turnStartedAt))}` : ""}`} />
      <Row c={c} label="model" value={`${shortModel(agent.model)}${agent.thinking ? ` · ${agent.thinking}` : ""}${agent.mode ? ` · ${agent.mode}` : ""}`} />
      <Row c={c} label="context" value={`ctx ${agent.contextPct ?? "?"}% · ${tokens(agent.usedTokens)}/${tokens(agent.maxTokens)}`} />
      <Row c={c} label="id" value={`${agent.id.slice(0, 8)} · ${ago(agent.createdAt, nowMs)} old`} />
      {agent.activity ? <Row c={c} label="now" value={agent.activity.detail} /> : null}
      {q.error ? <Text style={{ color: c.statusDanger, fontSize: 11 }}>{`Detail failed: ${String(q.error.message)}`}</Text> : null}
      {d && !d.ok ? <Text style={{ color: c.statusDanger, fontSize: 11 }}>{`${d.code}: ${d.message}`}</Text> : null}
      {d?.ok ? (
        <>
          <Text style={{ color: c.foregroundMuted, fontSize: 10, fontWeight: "800" }}>LAST PROMPT</Text>
          <Text selectable style={{ color: c.foreground, fontSize: 11 }}>{d.lastCommand ? clip(d.lastCommand.text, 280) : "none seen"}</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 10, fontWeight: "800" }}>LAST REPLY</Text>
          <Text selectable style={{ color: c.foreground, fontSize: 11 }}>{d.lastReply ? clip(d.lastReply.text, 280) : "none seen"}</Text>
        </>
      ) : null}
      {files.length > 0 ? <Text style={{ color: c.foregroundMuted, fontSize: 10, fontWeight: "800" }}>FILES HELD</Text> : null}
      {files.map((f) => (
        <Text key={f.path} selectable numberOfLines={1} style={{ color: f.writers >= 2 ? c.statusDanger : c.foreground, fontSize: 11 }}>
          {`${f.op} ${f.name}${f.writers >= 2 ? ` · ${f.writers} writers` : ""}`}
        </Text>
      ))}
      {d?.ok && d.recent.length > 0 ? <Text style={{ color: c.foregroundMuted, fontSize: 10, fontWeight: "800" }}>RECENT</Text> : null}
      {d?.ok
        ? d.recent.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Icon name={ACTIVITY_ICON[r.kind]} size={12} color={activityHue(c, r.kind)} />
              <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, flex: 1 }}>
                {r.label}
              </Text>
              <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{ago(r.at, nowMs)}</Text>
            </View>
          ))
        : null}
    </Card>
  );
}

function SwarmInspector({ c, group, onClose, onSelectAgent }: { c: Colors; group: SwarmGroup; onClose: () => void; onSelectAgent: (id: string) => void }) {
  return (
    <Card c={c} title={`SWARM ${group.name}`} right={<SmallButton c={c} icon="X" label="Close inspector" onPress={onClose} />}>
      <View style={{ flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: c.surface2 }}>
        {(["working", "waiting", "error", "sleep"] as const).map((s) => {
          const n = group.agents.filter((a) => agentState(a) === s).length;
          return n > 0 ? <View key={s} style={{ flex: n, backgroundColor: stateColor(c, s) }} /> : null;
        })}
      </View>
      <Row c={c} label="agents" value={String(group.agents.length)} />
      <Row c={c} label="wave" value={waveLine(group.wave)} />
      {group.agents.map((a) => (
        <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Select ${a.title}`} onPress={() => onSelectAgent(a.id)} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stateColor(c, agentState(a)) }} />
          <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, flex: 1 }}>
            {a.title}
          </Text>
        </Pressable>
      ))}
    </Card>
  );
}

export function Inspector(props: { c: Colors; target: InspectorTarget; nowMs: number; onClose: () => void; onSelectAgent: (id: string) => void }) {
  const { c, target } = props;
  if ("group" in target) return <SwarmInspector c={c} group={target.group} onClose={props.onClose} onSelectAgent={props.onSelectAgent} />;
  return <AgentInspector key={target.agent.id} c={c} agent={target.agent} files={target.files} nowMs={props.nowMs} onClose={props.onClose} />;
}

function FeedRow({ c, e, live, nowMs, onSelect }: { c: Colors; e: SwarmEvent; live: boolean; nowMs: number; onSelect: () => void }) {
  const t = useAppear(live);
  return (
    <Animated.View style={{ opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }] }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Select ${e.title}`} onPress={onSelect} style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 }}>
        <Icon name={e.kind === "tool" && e.activity ? ACTIVITY_ICON[e.activity.kind] : EVENT_ICON[e.kind]} size={12} color={e.kind === "tool" && e.activity ? activityHue(c, e.activity.kind) : eventHue(c, e.kind)} />
        <Text numberOfLines={1} style={{ color: c.foreground, fontSize: 11, fontWeight: "700", maxWidth: 110 }}>
          {e.title}
        </Text>
        <Text numberOfLines={1} style={{ color: c.foregroundMuted, fontSize: 11, flex: 1 }}>
          {eventText(e)}
        </Text>
        <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{ago(e.at, nowMs)}</Text>
      </Pressable>
    </Animated.View>
  );
}

export function ActivityFeed(props: { c: Colors; events: SwarmEvent[]; liveFromSeq: number; perMinute: number; nowMs: number; onSelectAgent: (id: string) => void }) {
  const { c } = props;
  return (
    <Card c={c} title="ACTIVITY" right={<Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{`${props.perMinute} actions/min`}</Text>}>
      {props.events.length === 0 ? <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>Nothing yet.</Text> : null}
      {props.events.map((e) => (
        <FeedRow key={e.seq} c={c} e={e} live={e.seq > props.liveFromSeq} nowMs={props.nowMs} onSelect={() => props.onSelectAgent(e.agentId)} />
      ))}
    </Card>
  );
}

export function Legend({ c }: { c: Colors }) {
  return (
    <Card c={c} title="LEGEND">
      {LEGEND.map((row) => (
        <View key={row.text} style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
          <Icon name={row.icon} size={12} color={row.hue(c)} />
          <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{row.text}</Text>
        </View>
      ))}
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>Ring around a node = context window use; it turns to the warning colour at the project's ph context ROTATE threshold.</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>Hub ring = .planning wave progress of the swarm's workflow run, or the share of running agents when unlinked.</Text>
    </Card>
  );
}
