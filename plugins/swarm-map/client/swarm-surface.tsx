// Swarm surface: a live, animated, read-only map of who orchestrates what (brain -> swarm hubs -> agents).
// Data: swarm.snapshot polled every SNAPSHOT_POLL_MS (plugins have no push, PANL-07); events drive one-shot effects.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, Pressable, Text, View } from "react-native";
import type { FileHold, SwarmAgent, SwarmEvent, SwarmSnapshot } from "../shared/swarm.ts";
import { swarmSnapshotRpc } from "../shared/swarm.ts";
import { ClockContext, useClockSource } from "./anim.ts";
import { type Effect, type EffectContext, effectsFor, nextEffectId } from "./effects.ts";
import { type Layout, type Point, computeLayout, createSlotBook, fileAnchor, pathToAgent } from "./geometry.ts";
import { Burst, FlowDots, Link, Packet, Sparks } from "./links.tsx";
import { AgentNode, BrainNode, type Ghost, GhostNode, HubNode } from "./nodes.tsx";
import { type Colors, DECOR, agentState, stateColor } from "./palette.ts";
import { ActivityFeed, Inspector, type InspectorTarget, Legend } from "./panels.tsx";
import {
  type AppearMode,
  EMPTY_BOOK,
  ERRORS_SHOWN,
  NEW_BADGE_MS,
  RECENT_HOURS,
  SNAPSHOT_POLL_MS,
  START_FEED,
  type Selection,
  actionsPerMinute,
  appearance,
  applySnapshot,
  capEffects,
  effectEvents,
  fitZoom,
  headerCounts,
  snapshotInput,
  subtitle,
  thresholdLabel,
  toggleSelection,
  zoomIn,
  zoomOut,
  zoomText,
} from "./state.ts";

const PANEL_W = 380;
const COMPACT_CANVAS_MIN_H = 420;

type Shown = Effect | { id: string; type: "ghost"; ghost: Ghost };

export function SwarmSurface({ theme, layout }: PluginSurfaceProps) {
  const clocks = useClockSource();
  return (
    <ClockContext.Provider value={clocks}>
      <SwarmMap c={theme.colors} compact={layout.compact} />
    </ClockContext.Provider>
  );
}

const isRunning = (a: SwarmAgent) => a.status === "running" || a.status === "initializing";

function Stat({ c, icon, hue, value, label }: { c: Colors; icon: string; hue: string; value: number; label: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: c.surface1, borderWidth: 1, borderColor: c.border }}>
      <Icon name={icon} size={14} color={hue} />
      <Text style={{ color: c.foreground, fontSize: 14, fontWeight: "800" }}>{value}</Text>
      <Text style={{ color: c.foregroundMuted, fontSize: 11 }}>{label}</Text>
    </View>
  );
}

function Button({ c, icon, label, text, on, onPress }: { c: Colors; icon: string; label: string; text?: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, height: 28, paddingHorizontal: text ? 9 : 7, borderRadius: 8, backgroundColor: on ? c.accent : c.surface1, borderWidth: 1, borderColor: on ? c.accent : c.border }}
    >
      <Icon name={icon} size={13} color={on ? c.accentForeground : c.foregroundMuted} />
      {text ? <Text style={{ color: on ? c.accentForeground : c.foreground, fontSize: 12 }}>{text}</Text> : null}
    </Pressable>
  );
}

function Canvas(props: {
  c: Colors;
  layout: Layout;
  selection: Selection | null;
  appear: (id: string) => AppearMode;
  newIds: ReadonlySet<string>;
  filesByAgent: ReadonlyMap<string, FileHold[]>;
  effects: Shown[];
  nowMs: number;
  onSelect: (s: Selection) => void;
  onEffectDone: (e: Shown) => void;
}) {
  const { c, layout, selection } = props;
  const selectedPath = selection?.kind === "agent" ? pathToAgent(layout, selection.id) : null;
  return (
    <View style={{ width: layout.width, height: layout.height }}>
      {layout.hubs.map((h) => {
        const active = h.group.agents.some(isRunning);
        return (
          <View key={`l-${h.id}`} pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
            {h.orbits.map((o) => (
              <View key={o} style={{ position: "absolute", left: h.x - o, top: h.y - o, width: o * 2, height: o * 2, borderRadius: o, borderWidth: 1, borderStyle: "dashed", borderColor: c.border }} />
            ))}
            <Link points={h.edge} color={active ? c.accent : c.border} active={active} thickness={3} />
            {active ? <FlowDots points={h.edge} color={DECOR.prompt} count={4} size={7} /> : null}
          </View>
        );
      })}
      {layout.agents.map((p) => {
        const state = agentState(p.agent);
        const hue = state === "sleep" ? c.border : stateColor(c, state);
        return (
          <View key={`l-${p.agent.id}`} pointerEvents="none" style={{ position: "absolute", left: 0, top: 0 }}>
            <Link points={p.edge} color={hue} active={state !== "sleep"} dim={state === "sleep"} />
            {isRunning(p.agent) ? <FlowDots points={p.edge} color={hue} count={2} size={5} offset={((p.x + p.y) % 100) / 100} /> : null}
          </View>
        );
      })}
      {selectedPath ? <Link points={selectedPath} color={c.foreground} active thickness={2} /> : null}
      {layout.brains.map((b) => (
        <BrainNode key={`b-${b.key}`} c={c} place={b} selected={selection?.kind === "brain" && selection.id === b.key} appear={props.appear(`b-${b.key}`)} nowMs={props.nowMs} onPress={() => props.onSelect({ kind: "brain", id: b.key })} />
      ))}
      {layout.hubs.map((h) => (
        <HubNode key={`h-${h.id}`} c={c} place={h} selected={selection?.kind === "hub" && selection.id === h.id} appear={props.appear(`h-${h.id}`)} onPress={() => props.onSelect({ kind: "hub", id: h.id })} />
      ))}
      {layout.agents.map((p, i) => (
        <AgentNode
          key={`a-${p.agent.id}`}
          c={c}
          place={p}
          selected={selection?.kind === "agent" && selection.id === p.agent.id}
          appear={props.appear(p.agent.id)}
          bootIndex={i}
          isNew={props.newIds.has(p.agent.id)}
          nowMs={props.nowMs}
          files={props.filesByAgent.get(p.agent.id) ?? []}
          onPress={() => props.onSelect({ kind: "agent", id: p.agent.id })}
        />
      ))}
      {props.effects.map((e) => {
        const done = () => props.onEffectDone(e);
        if (e.type === "packet") return <Packet key={e.id} spec={e.spec} c={c} onDone={done} />;
        if (e.type === "burst") return <Burst key={e.id} x={e.x} y={e.y} r={e.r} hue={e.hue} onDone={done} />;
        if (e.type === "sparks") return <Sparks key={e.id} x={e.x} y={e.y} hue={e.hue} onDone={done} />;
        return <GhostNode key={e.id} c={c} ghost={e.ghost} onDone={done} />;
      })}
    </View>
  );
}

function SwarmMap({ c, compact }: { c: Colors; compact: boolean }) {
  const [recentOnly, setRecentOnly] = useState(true);
  const [zoom, setZoom] = useState<number | null>(null); // null = fit width
  const [selection, setSelection] = useState<Selection | null>(null);
  const [viewportW, setViewportW] = useState(0);
  const [feed, setFeed] = useState(START_FEED);
  const [effects, setEffects] = useState<Shown[]>([]);
  const [data, setData] = useState<SwarmSnapshot | null>(null);
  const [modes, setModes] = useState<ReadonlyMap<string, AppearMode>>(new Map());

  const snapshotRpc = useRpc(swarmSnapshotRpc);
  const feedRef = useRef(feed);
  feedRef.current = feed;
  const q = useQuery({
    queryKey: ["swarm-snapshot", recentOnly],
    queryFn: () => snapshotRpc(snapshotInput(feedRef.current.cursor, recentOnly)),
    refetchInterval: SNAPSHOT_POLL_MS,
  });
  const res = q.data;
  const failure = q.error ? String(q.error.message) : res && !res.ok ? res.message : null;
  const nowMs = data ? Date.parse(data.generatedAt) : 0;

  const slots = useRef(createSlotBook()).current;
  const layout = useMemo(() => computeLayout(data?.brains ?? [], slots, nowMs), [data, slots, nowMs]);

  // Appearance bookkeeping (PANL-49): everything boots in once; agents seen later spring in with NEW; a filter
  // change re-boots without NEW and without ghosts. Modes travel with the snapshot that first draws a node.
  const book = useRef(EMPTY_BOOK);
  const born = useRef(new Map<string, number>()).current;
  const viewKey = String(recentOnly);
  const prevLayout = useRef<Layout | null>(null);
  const lastToolAt = useRef(new Map<string, number>()).current;
  const lastPos = useRef(new Map<string, Point>()).current;

  const appear = (id: string): AppearMode => modes.get(id) ?? "none";
  const newIds = new Set([...born].filter(([, t]) => nowMs - t < NEW_BADGE_MS).map(([id]) => id));

  const onEffectDone = useCallback((e: Shown) => {
    setEffects((cur) => {
      const rest = cur.filter((x) => x.id !== e.id);
      return e.type === "packet" && e.arrive ? capEffects([...rest, { id: nextEffectId(), type: "burst", ...e.arrive }]) : rest;
    });
  }, []);

  useEffect(() => {
    if (!res || !res.ok) return;
    const booted = book.current.booted;
    const viewChanged = booted && book.current.viewKey !== viewKey;
    const now = Date.parse(res.generatedAt);
    const current = computeLayout(res.brains, slots, now);
    const onMap = (id: string) => current.byAgent.has(id) || current.byBrain.has(id);
    const applied = applySnapshot(feedRef.current, res, onMap);
    const list: Shown[] = [];
    const ids = [...current.agents.map((p) => p.agent.id), ...current.brains.map((b) => `b-${b.key}`), ...current.hubs.map((h) => `h-${h.id}`)];
    const next = appearance(book.current, ids, viewKey);
    for (const p of current.agents) if (next.modes.get(p.agent.id) === "spawn") born.set(p.agent.id, now);
    const prev = prevLayout.current;
    if (prev && !viewChanged) {
      const archived = new Set(applied.live.filter((e) => e.kind === "archive").map((e) => e.agentId));
      for (const p of prev.agents) {
        if (current.byAgent.has(p.agent.id)) continue;
        const hub = prev.byHub.get(p.hubId);
        const reason = archived.has(p.agent.id) ? "archived" : "gone";
        list.push({ id: nextEffectId(), type: "ghost", ghost: { agent: p.agent, x: p.x, y: p.y, hubX: hub?.x ?? p.x, hubY: hub?.y ?? p.y, reason } });
      }
    }
    if (booted && !viewChanged) {
      const ctx: EffectContext = { lastToolAt, lastPos };
      for (const e of effectEvents(applied.live)) list.push(...effectsFor(e, current, c, ctx, now));
    }
    for (const p of current.agents) lastPos.set(p.agent.id, fileAnchor(current, p.agent.id) ?? { x: p.x, y: p.y });
    for (const [id, t] of born) if (now - t > NEW_BADGE_MS) born.delete(id);
    prevLayout.current = current;
    book.current = next.book;
    setFeed(applied.state);
    setModes(next.modes);
    setData(res);
    if (list.length > 0) setEffects((cur) => capEffects([...cur, ...list]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res]);

  const filesByAgent = useMemo(() => {
    const m = new Map<string, FileHold[]>();
    for (const f of data?.files ?? []) m.set(f.agentId, [...(m.get(f.agentId) ?? []), f]);
    return m;
  }, [data]);

  // A selection whose node vanished closes the inspector (PANL-52).
  const target = useMemo<InspectorTarget | null>(() => {
    if (!selection) return null;
    if (selection.kind === "hub") {
      const hub = layout.byHub.get(selection.id);
      return hub ? { group: hub.group } : null;
    }
    const agent = selection.kind === "agent" ? layout.byAgent.get(selection.id)?.agent : layout.byBrain.get(selection.id)?.brain.agent;
    return agent ? { agent, files: filesByAgent.get(agent.id) ?? [] } : null;
  }, [selection, layout, filesByAgent]);

  const select = useCallback((s: Selection) => setSelection((cur) => toggleSelection(cur, s)), []);
  const selectAgent = useCallback(
    (id: string) => {
      if (layout.byAgent.has(id)) setSelection({ kind: "agent", id });
      else if (layout.byBrain.has(id)) setSelection({ kind: "brain", id });
    },
    [layout],
  );

  const drawn = layout.brains.flatMap((b) => [...(b.brain.agent ? [b.brain.agent] : []), ...b.brain.groups.flatMap((g) => g.agents)]);
  const counts = headerCounts(drawn, data?.files ?? []);
  const z = zoom ?? fitZoom(viewportW, layout.width);
  const onCanvasLayout = (e: LayoutChangeEvent) => setViewportW(e.nativeEvent.layout.width);
  const feedEvents: SwarmEvent[] = feed.events;

  const header = (
    <View style={{ paddingHorizontal: compact ? 10 : 16, paddingVertical: 10, gap: 10, borderBottomWidth: 1, borderColor: c.border, backgroundColor: c.surface0 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginRight: 6 }}>
          <Icon name="Orbit" size={20} color={c.accent} />
          <View>
            <Text style={{ color: c.foreground, fontSize: 17, fontWeight: "900", letterSpacing: 1 }}>SWARM</Text>
            <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{subtitle(failure !== null, data, layout.hubs.length)}</Text>
          </View>
        </View>
        <Stat c={c} icon="Activity" hue={c.statusSuccess} value={counts.running} label="running" />
        <Stat c={c} icon="Moon" hue={c.foregroundMuted} value={counts.sleep} label="sleep" />
        <Stat c={c} icon="ShieldAlert" hue={c.statusWarning} value={counts.waiting} label="waiting" />
        <Stat c={c} icon="CircleX" hue={c.statusDanger} value={counts.error} label="error" />
        <Stat c={c} icon="Gauge" hue={c.statusWarning} value={counts.overThreshold} label={thresholdLabel(drawn)} />
        {counts.conflicts > 0 ? <Stat c={c} icon="TriangleAlert" hue={c.statusDanger} value={counts.conflicts} label="write conflicts" /> : null}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        <Button c={c} icon="Clock" label={`Active ${RECENT_HOURS}h`} text={`Active ${RECENT_HOURS}h`} on={recentOnly} onPress={() => setRecentOnly((v) => !v)} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto" }}>
          <Button c={c} icon="ZoomOut" label="Zoom out" onPress={() => setZoom(zoomOut(z))} />
          <Text style={{ color: c.foregroundMuted, fontSize: 11, width: 40, textAlign: "center" }}>{zoomText(z)}</Text>
          <Button c={c} icon="ZoomIn" label="Zoom in" onPress={() => setZoom(zoomIn(z))} />
          <Button c={c} icon="Maximize2" label="Fit to width" onPress={() => setZoom(null)} />
        </View>
      </View>
      {failure !== null ? <Text style={{ color: c.statusDanger, fontSize: 12 }}>{`Snapshot failed: ${failure}`}</Text> : null}
      {(data?.errors ?? []).slice(0, ERRORS_SHOWN).map((e) => (
        <Text key={e} numberOfLines={1} style={{ color: c.statusDanger, fontSize: 11 }}>
          {e}
        </Text>
      ))}
    </View>
  );

  const canvas = (
    <View style={{ flex: compact ? undefined : 1, minHeight: compact ? COMPACT_CANVAS_MIN_H : undefined, backgroundColor: c.surface0 }} onLayout={onCanvasLayout}>
      {data && layout.brains.length === 0 ? (
        <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
          <Icon name="Telescope" size={36} color={c.foregroundMuted} />
          <Text style={{ color: c.foreground, fontSize: 15, fontWeight: "700" }}>No swarm is flying right now</Text>
          <Text style={{ color: c.foregroundMuted, fontSize: 12, textAlign: "center" }}>
            {recentOnly ? `No brain with subagents was active in the last ${RECENT_HOURS} h. Turn off "Active ${RECENT_HOURS}h" to see older ones.` : "No agent spawned by ph has subagents."}
          </Text>
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }}>
        <ScrollView horizontal>
          <View style={{ width: layout.width * z, height: layout.height * z }}>
            <View
              style={{
                position: "absolute",
                width: layout.width,
                height: layout.height,
                transform: [{ translateX: (layout.width * z - layout.width) / 2 }, { translateY: (layout.height * z - layout.height) / 2 }, { scale: z }],
              }}
            >
              <Canvas c={c} layout={layout} selection={selection} appear={appear} newIds={newIds} filesByAgent={filesByAgent} effects={effects} nowMs={nowMs} onSelect={select} onEffectDone={onEffectDone} />
            </View>
          </View>
        </ScrollView>
      </ScrollView>
    </View>
  );

  const panel = (
    <View style={compact ? { padding: 12 } : { width: PANEL_W, borderLeftWidth: 1, borderColor: c.border }}>
      <ScrollView contentContainerStyle={{ padding: compact ? 0 : 12, gap: 12 }}>
        {target ? <Inspector c={c} target={target} nowMs={nowMs} onClose={() => setSelection(null)} onSelectAgent={selectAgent} /> : null}
        {!target ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderStyle: "dashed", borderColor: c.border }}>
            <Icon name="MousePointerClick" size={16} color={c.foregroundMuted} />
            <Text style={{ color: c.foregroundMuted, fontSize: 12, flex: 1 }}>Click a brain, swarm or agent to inspect it: prompt, reply, files held and recent actions.</Text>
          </View>
        ) : null}
        <ActivityFeed c={c} events={feedEvents} liveFromSeq={feed.liveFromSeq} perMinute={actionsPerMinute(feedEvents, nowMs)} nowMs={nowMs} onSelectAgent={selectAgent} />
        <Legend c={c} />
        {data ? <Text style={{ color: c.foregroundMuted, fontSize: 10 }}>{`${data.standaloneCount} agents without parent or subagents are not drawn`}</Text> : null}
      </ScrollView>
    </View>
  );

  // PANL-54: compact stacks canvas above the panel in one scroll view; otherwise canvas plus a side panel.
  return (
    <View style={{ flex: 1, backgroundColor: c.surface0 }}>
      {header}
      {compact ? (
        <ScrollView style={{ flex: 1 }}>
          {canvas}
          {panel}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, flexDirection: "row" }}>
          {canvas}
          {panel}
        </View>
      )}
    </View>
  );
}
