// Plan pane and file reader (PANL-16, PANL-17). A body is rendered only when the response matches the open item
// (workspace, relative path, plan id); otherwise the loading state shows, never an older body. A failed request
// shows an unreachable state with retry, or marks a shown body as stale (CR-PNL-08).
import { copyText } from "@getpaseo/plugin/client/react-native";
import { View } from "react-native";
import type { ReactNode } from "react";
import type { PlanningIndex } from "../shared/planning.ts";
import { linkContext, useFile, usePlan } from "./data.ts";
import { formatClock } from "./format.ts";
import { Badge, IconButton, MetaRow, Section, StatePanel, T, useKit } from "./kit.tsx";
import type { Target } from "./markdown.ts";
import { Markdown } from "./markdown-view.tsx";
import { type DetailView, detailView, responseMatches } from "./nav.ts";

interface PaneProps {
  workspaceId: string;
  index: PlanningIndex | null;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  onOpen: (target: Target, from: string) => void;
}

function Toolbar({ title, copyId, copyPath, canGoBack, onBack, onClose }: { title: string; copyId?: string; copyPath: string; canGoBack: boolean; onBack: () => void; onClose: () => void }) {
  const { colors } = useKit();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingBottom: 8, borderBottomWidth: 1, borderColor: colors.border }}>
      {canGoBack ? <IconButton icon="ArrowLeft" label="Back" onPress={onBack} /> : null}
      <T size={15} weight="700" lines={1} style={{ flex: 1 }}>
        {title}
      </T>
      {copyId ? <IconButton icon="Hash" label="Copy id" onPress={() => void copyText(copyId)} /> : null}
      <IconButton icon="Copy" label="Copy path" onPress={() => void copyText(`.planning/${copyPath}`)} />
      <IconButton icon="X" label="Close" onPress={onClose} />
    </View>
  );
}

interface DetailQuery {
  error: Error | null;
  dataUpdatedAt: number;
  refetch: () => Promise<unknown>;
}

// A pane that cannot draw its body: typed failure, unreachable daemon (with retry) or loading.
function Status({ view, q, toolbar, what, failure }: { view: DetailView; q: DetailQuery; toolbar: ReactNode; what: string; failure: ReactNode }) {
  const retry = <IconButton icon="RefreshCw" label="Retry" onPress={() => void q.refetch()} />;
  if (view.state === "failure") return <View style={{ gap: 10 }}>{toolbar}{failure}</View>;
  if (view.state === "unreachable")
    return (
      <View style={{ gap: 10 }}>
        {toolbar}
        <StatePanel icon="WifiOff" tone="danger" title="Daemon not reachable" body={q.error?.message ?? `could not load the ${what}`} />
        {retry}
      </View>
    );
  return <View style={{ gap: 10 }}>{toolbar}<StatePanel icon="Loader" busy title={`Loading ${what}`} /></View>;
}

function StaleNote({ q }: { q: DetailQuery }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <T tone="warning" size={12} style={{ flex: 1 }}>{`Reconnecting · showing what was read at ${formatClock(q.dataUpdatedAt)}`}</T>
      <IconButton icon="RefreshCw" label="Retry" onPress={() => void q.refetch()} />
    </View>
  );
}

function List({ items }: { items: string[] }) {
  return <T size={13} selectable>{items.length ? items.join(", ") : "—"}</T>;
}

export function PlanPane(props: PaneProps & { planId: string }) {
  const { workspaceId, planId, index } = props;
  const path = index?.files.find((f) => f.kind === "plan" && f.planId === planId)?.path;
  const q = usePlan(workspaceId, planId);
  const d = q.data;
  const toolbar = <Toolbar title={`Plan ${planId}`} copyId={planId} copyPath={path ?? planId} canGoBack={props.canGoBack} onBack={props.onBack} onClose={props.onClose} />;
  const view = detailView(q, responseMatches({ workspaceId, planId, path }, d));
  if (view.state !== "ready" || !d || !d.ok)
    return <Status view={view} q={q} toolbar={toolbar} what="plan" failure={d && !d.ok ? <StatePanel icon="CircleAlert" tone="danger" title={d.code} body={d.message} /> : null} />;
  const truths = (d.mustHaves as { truths?: unknown } | null)?.truths;
  return (
    <View style={{ gap: 12 }}>
      {toolbar}
      {view.stale ? <StaleNote q={q} /> : null}
      {d.goal ? <T selectable>{d.goal}</T> : null}
      <Section title="Plan">
        <MetaRow label="Completion">
          {d.summary ? <Badge label={d.summary.status ?? "summarised"} tone={d.summary.done ? "success" : "danger"} /> : <Badge label="not done" tone="muted" />}
        </MetaRow>
        <MetaRow label="Wave"><T size={13}>{d.wave === null ? "—" : String(d.wave)}</T></MetaRow>
        <MetaRow label="Depends on"><List items={d.dependsOn} /></MetaRow>
        <MetaRow label="Requirements"><List items={d.requirements} /></MetaRow>
        <MetaRow label="Files"><List items={d.filesModified} /></MetaRow>
        {d.properties.map((p) => (
          <MetaRow key={p.key} label={p.key}><T size={13} selectable>{p.value}</T></MetaRow>
        ))}
      </Section>
      <Section title="Tasks" trailing={`${d.tasks.length}`}>
        {d.tasks.map((t, i) => (
          <View key={i} style={{ gap: 2 }}>
            <T size={13} weight="600">{t.name}</T>
            <T size={11} tone="muted">{`${t.type ?? "task"}${t.files.length ? ` · ${t.files.join(", ")}` : ""}`}</T>
          </View>
        ))}
      </Section>
      {Array.isArray(truths) && truths.length > 0 ? (
        <Section title="Must be true">
          {truths.map((t, i) => (
            <T key={i} size={13} selectable>{`• ${typeof t === "string" ? t : JSON.stringify(t)}`}</T>
          ))}
        </Section>
      ) : null}
      {d.summary ? (
        <Section title="Summary" trailing={d.summary.path}>
          <MetaRow label="Created"><List items={d.summary.keyFiles.created} /></MetaRow>
          <MetaRow label="Modified"><List items={d.summary.keyFiles.modified} /></MetaRow>
          <Markdown source={d.summary.text} ctx={linkContext(index, d.summary.path)} onOpen={(t) => props.onOpen(t, d.summary!.path)} />
        </Section>
      ) : null}
    </View>
  );
}

export function FileReader(props: PaneProps & { path: string }) {
  const { workspaceId, path, index } = props;
  const q = useFile(workspaceId, path);
  const d = q.data;
  const toolbar = <Toolbar title={path.split("/").pop() ?? path} copyPath={path} canGoBack={props.canGoBack} onBack={props.onBack} onClose={props.onClose} />;
  const view = detailView(q, responseMatches({ workspaceId, path }, d));
  if (view.state !== "ready" || !d || !d.ok)
    return <Status view={view} q={q} toolbar={toolbar} what="file" failure={d && !d.ok ? <StatePanel icon="FileX" tone="danger" title={d.code} body={d.message} /> : null} />;
  return (
    <View style={{ gap: 12 }}>
      {toolbar}
      {view.stale ? <StaleNote q={q} /> : null}
      {d.error ? <T tone="danger" size={12}>{`frontmatter line ${d.error.line}: ${d.error.message}`}</T> : null}
      {d.properties.length > 0 ? (
        <Section title="Properties">
          {d.properties.map((p) => (
            <MetaRow key={p.key} label={p.key}><T size={13} selectable>{p.value}</T></MetaRow>
          ))}
        </Section>
      ) : null}
      <Markdown source={d.body} ctx={linkContext(index, d.path)} onOpen={(t) => props.onOpen(t, d.path)} />
      {d.truncated ? <T tone="muted" size={11}>File cut at 1 MiB.</T> : null}
    </View>
  );
}
