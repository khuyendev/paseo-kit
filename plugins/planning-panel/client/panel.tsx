// Workspace panel (PANL-21): section tabs, a trail of opened items, split view when wide, a 30 s tick for
// relative times and a refresh button showing `Live · HH:MM:SS` or `Reconnecting`.
import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useReducer, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import type { PlanningIndex } from "../shared/planning.ts";
import { useBoard, useIndex } from "./data.ts";
import { FileReader, PlanPane } from "./details.tsx";
import { formatClock } from "./format.ts";
import { IconButton, KitProvider, StatePanel, T, useKit } from "./kit.tsx";
import type { Target } from "./markdown.ts";
import { type Item, SECTIONS, type Section, TICK_MS, liveText, splitView, trailReducer } from "./nav.ts";
import { BoardView, FilesView, PhasesView, SectionTabs, StatsView } from "./views.tsx";

export function PlanningPanel({ workspaceId, theme, layout }: Pick<PluginWorkspacePanelProps, "workspaceId" | "theme" | "layout">) {
  return (
    <KitProvider theme={theme} compact={layout.compact}>
      <PlanningBody workspaceId={workspaceId} />
    </KitProvider>
  );
}

function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

// Where a target from rendered markdown leads: indexed files and plans open in the panel.
function itemFor(target: Target, index: PlanningIndex | null): Item | null {
  if (target.type === "file") {
    const f = index?.files.find((x) => x.path === target.path);
    return f?.kind === "plan" && f.planId ? { kind: "plan", id: f.planId } : { kind: "file", path: target.path };
  }
  if (target.type !== "id") return null;
  if (index?.files.some((f) => f.kind === "plan" && f.planId === target.id)) return { kind: "plan", id: target.id };
  if (/^Phase /.test(target.id)) return index?.files.some((f) => f.path === "ROADMAP.md") ? { kind: "file", path: "ROADMAP.md" } : null;
  return index?.files.some((f) => f.path === "REQUIREMENTS.md") ? { kind: "file", path: "REQUIREMENTS.md" } : null;
}

export function PlanningBody({ workspaceId }: { workspaceId: string }) {
  const { colors, compact } = useKit();
  const [section, setSection] = useState<Section>("Roadmap");
  const [focus, setFocus] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const [trail, dispatch] = useReducer(trailReducer, []);
  const [width, setWidth] = useState(0);
  const nowMs = useTick(TICK_MS);
  const indexQ = useIndex(workspaceId);
  const boardQ = useBoard(workspaceId);
  const index = indexQ.data?.ok ? indexQ.data : null;
  const open = trail[trail.length - 1] ?? null;
  const split = splitView(compact, width);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // Switching workspace resets what is open.
  useEffect(() => {
    dispatch({ type: "close" });
    setFocus(null);
  }, [workspaceId]);
  // Refresh rereads the lists and the open detail (CR-PNL-08).
  const refresh = () =>
    Promise.all([indexQ.refetch(), boardQ.refetch(), ...["planning-plan", "planning-file"].map((k) => queryClient.refetchQueries({ queryKey: [k, workspaceId], type: "active" }))]);
  const changeSection = (s: Section) => {
    setFocus(null);
    setSection(s);
  };
  const showPhase = (id: string) => {
    setFocus(id);
    setSection("Phases");
  };

  const header = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      <SectionTabs sections={SECTIONS} active={section} onChange={changeSection} />
      <View style={{ flex: 1 }} />
      <T size={11} tone={indexQ.isError ? "warning" : "muted"}>
        {liveText(indexQ.isError, indexQ.dataUpdatedAt || nowMs, formatClock)}
      </T>
      <IconButton icon="RefreshCw" label="Refresh" busy={indexQ.isFetching} onPress={() => void refresh()} />
    </View>
  );

  if (indexQ.isPending) return <StatePanel icon="Loader" busy title="Reading .planning/" />;
  if (indexQ.isError && !indexQ.data) return <StatePanel icon="WifiOff" tone="danger" title="Daemon not reachable" body={String(indexQ.error.message)} />;
  const res = indexQ.data;
  if (res && !res.ok) {
    if (res.code === "no_planning") return <StatePanel icon="FolderSearch" title="No .planning/ folder" body="This workspace has no .planning/ yet. The GSD flows create it (run gsd-new-project in an agent)." />;
    return <StatePanel icon="CircleAlert" tone="danger" title={res.code} body={res.message} />;
  }

  const select = (item: Item) => dispatch({ type: "select", item });
  const follow = (target: Target) => {
    const item = itemFor(target, index);
    if (item) dispatch({ type: "link", item });
  };
  const paneProps = { workspaceId, index, canGoBack: trail.length > 1 || !split, onBack: () => dispatch({ type: "back" }), onClose: () => dispatch({ type: "close" }), onOpen: follow };
  const detail = open ? open.kind === "plan" ? <PlanPane key={`p:${open.id}`} {...paneProps} planId={open.id} /> : <FileReader key={`f:${open.path}`} {...paneProps} path={open.path} /> : null;

  const list = index ? (
    <View style={{ gap: 12 }}>
      {index.unreadable ? <T tone="warning" size={12}>{`Could not read ${index.unreadable}; counts are partial.`}</T> : null}
      {index.scope === "truncated" ? <T tone="warning" size={12}>{`Showing the first 5,000 of ${index.total} files.`}</T> : null}
      {section === "Roadmap" ? (
        <>
          <StatsView index={index} nowMs={nowMs} />
          {boardQ.isError ? <T tone="danger" size={12}>{`${boardQ.data ? "Board may be out of date; the last refresh failed" : "Could not load the board"}: ${boardQ.error.message}`}</T> : null}
          {boardQ.data?.ok ? <BoardView board={boardQ.data} onShowPhase={showPhase} /> : boardQ.data ? <T tone="danger">{boardQ.data.message}</T> : null}
        </>
      ) : null}
      {section === "Phases" ? <PhasesView index={index} onOpen={select} nowMs={nowMs} focus={focus} onShowAll={() => setFocus(null)} /> : null}
      {section === "Files" ? (index.files.length ? <FilesView files={index.files} onOpen={select} openPath={open?.kind === "file" ? open.path : null} /> : <T tone="muted">.planning/ is empty.</T>) : null}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface0 }} onLayout={onLayout}>
      {header}
      {split ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>{list}</ScrollView>
          {detail ? <ScrollView style={{ flex: 1, borderLeftWidth: 1, borderColor: colors.border }} contentContainerStyle={{ padding: 12 }}>{detail}</ScrollView> : null}
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12 }}>
          {detail ?? list}
        </ScrollView>
      )}
    </View>
  );
}
