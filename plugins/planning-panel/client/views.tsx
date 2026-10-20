// Sections of the workspace panel: Roadmap (stats + ladder board), Phases (plans per wave), Files (tree).
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import type { Board, BoardPhase, IndexFile, PlanningIndex } from "../shared/planning.ts";
import { STATUS_LABEL, STATUS_TONE } from "../shared/planning.ts";
import { formatRelative, formatShortDate } from "./format.ts";
import { Badge, Chip, IconButton, Press, ProgressBar, SegmentedBar, Section, T, useKit } from "./kit.tsx";
import type { Item } from "./nav.ts";
import { computeStats } from "./stats.ts";
import { allFolders, ancestors, buildTree, filterFiles, topLevelFolders } from "./tree.ts";

const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors } = useKit();
  return (
    <View style={{ minWidth: 120, flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 2 }}>
      <T size={11} tone="muted" upper>
        {label}
      </T>
      <T size={20} weight="800">
        {value}
      </T>
      {sub ? (
        <T size={11} tone="muted">
          {sub}
        </T>
      ) : null}
    </View>
  );
}

export function StatsView({ index, nowMs }: { index: PlanningIndex; nowMs: number }) {
  const { colors } = useKit();
  const s = useMemo(() => computeStats(index, nowMs), [index, nowMs]);
  const maxDay = Math.max(1, ...s.filesPerDay.map((d) => d.count));
  return (
    <Section title="Stats" trailing={index.scope === "complete" ? undefined : `scope ${index.scope}: percentages withheld`}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Tile label="Phases" value={`${s.phases.done}/${s.phases.total}`} sub={`${s.phases.open} open · ${pctText(s.phases.pct)}`} />
        <Tile label="Plans" value={`${s.plans.done}/${s.plans.total}`} sub={pctText(s.plans.pct)} />
        <Tile label="Blocked" value={String(s.blocked.length)} sub={s.blocked.slice(0, 3).map((b) => b.planId).join(", ") || "none"} />
      </View>
      {s.waves.map((w) => (
        <View key={String(w.wave)} style={{ gap: 4 }}>
          <T size={12} tone="muted">{`wave ${w.wave ?? "?"} · ${w.done}/${w.total} plans`}</T>
          <ProgressBar value={w.done} total={w.total} tone="success" />
        </View>
      ))}
      {s.summariesByStatus.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {s.summariesByStatus.map((x) => (
            <Badge key={x.status} label={`${x.status} ${x.count}`} tone={/halted|failed/i.test(x.status) ? "danger" : "success"} />
          ))}
        </View>
      ) : null}
      <T size={11} tone="muted">Files updated per day (14 days)</T>
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 3, height: 48 }}>
        {s.filesPerDay.map((d) => (
          <View key={d.day} accessibilityLabel={`${formatShortDate(d.day)}: ${d.count} files`} style={{ flex: 1, height: Math.max(2, (d.count / maxDay) * 48), borderRadius: 2, backgroundColor: colors.accent, opacity: d.count ? 1 : 0.25 }} />
        ))}
      </View>
    </Section>
  );
}

function PhaseCard({ phase, onOpen }: { phase: BoardPhase; onOpen: (item: Item) => void }) {
  const { colors } = useKit();
  return (
    <View style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border, gap: 6, backgroundColor: colors.surface0 }}>
      <T size={13} weight="700" lines={2}>{`${phase.id} ${phase.name.replace(/-/g, " ")}`}</T>
      <T size={11} tone="muted">{`${phase.done}/${phase.plans} plans done · ${pctText(phase.pct)}`}</T>
      {phase.waves.map((w) => (
        <View key={String(w.wave)} style={{ gap: 3 }}>
          <T size={11} tone="muted">{`wave ${w.wave ?? "?"} · ${w.done}/${w.total}`}</T>
          <SegmentedBar segments={[{ tone: "success", count: w.done }, { tone: "muted", count: w.total - w.done }]} />
        </View>
      ))}
      <Press label={`Open phase ${phase.id} folder`} onPress={() => onOpen({ kind: "file", path: `${phase.dir}` })}>
        <T size={11} tone="accent">{phase.dir}</T>
      </Press>
    </View>
  );
}

export function BoardView({ board, onOpen }: { board: Board; onOpen: (item: Item) => void }) {
  return (
    <Section title="Phases by status" trailing={board.statusError ?? undefined}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {board.columns.map((col) => (
          <View key={col.status} style={{ minWidth: 180, flex: 1, gap: 8 }}>
            <Badge label={`${STATUS_LABEL[col.status]} · ${col.phases.length}`} tone={STATUS_TONE[col.status]} />
            {col.phases.map((p) => (
              <PhaseCard key={p.dir} phase={p} onOpen={onOpen} />
            ))}
          </View>
        ))}
      </View>
      {board.unsorted.length > 0 ? <T size={12} tone="warning">{`${board.unsorted.length} phases without a status`}</T> : null}
    </Section>
  );
}

export function PhasesView({ index, onOpen, nowMs }: { index: PlanningIndex; onOpen: (item: Item) => void; nowMs: number }) {
  const { colors } = useKit();
  const plansOf = (dir: string) => index.files.filter((f) => f.kind === "plan" && f.path.startsWith(`${dir}/`));
  const summary = (planId: string) => index.files.find((f) => f.kind === "summary" && f.planId === planId);
  if (index.phases.length === 0) return <T tone="muted">No phase folders under .planning/phases/ yet.</T>;
  return (
    <View style={{ gap: 10 }}>
      {index.phases.map((p) => (
        <Section key={p.dir} title={`Phase ${p.id} ${p.name.replace(/-/g, " ")}`} trailing={p.status ? STATUS_LABEL[p.status] : "status unknown"}>
          {plansOf(p.dir).map((f) => {
            const s = summary(f.planId!);
            return (
              <Press key={f.path} label={`Open plan ${f.planId}`} onPress={() => onOpen({ kind: "plan", id: f.planId! })} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
                <Icon name={s ? (/halted|failed/i.test(s.status ?? "") ? "CircleX" : "CircleCheck") : "Circle"} size={14} color={s ? (/halted|failed/i.test(s.status ?? "") ? colors.statusDanger : colors.statusSuccess) : colors.foregroundMuted} />
                <T size={13} weight="600">{f.planId}</T>
                <T size={13} lines={1} style={{ flex: 1 }}>{f.title}</T>
                <T size={11} tone="muted">{`w${f.wave ?? "?"} · ${s ? (s.status ?? "summarised") : "not done"} · ${formatRelative(f.mtimeMs, nowMs)}`}</T>
              </Press>
            );
          })}
        </Section>
      ))}
    </View>
  );
}

export function FilesView({ files, onOpen, openPath }: { files: IndexFile[]; onOpen: (item: Item) => void; openPath: string | null }) {
  const { colors } = useKit();
  const [query, setQuery] = useState("");
  const paths = useMemo(() => files.map((f) => f.path), [files]);
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const shown = query.trim() ? filterFiles(files, query).map((f) => f.path) : paths;
  const open = new Set([...(expanded ?? topLevelFolders(paths)), ...(openPath ? ancestors(openPath) : [])]);
  const rows = buildTree(shown, query.trim() ? "all" : open);
  const toggle = (path: string) => setExpanded((cur) => {
    const next = new Set(cur ?? topLevelFolders(paths));
    if (next.has(path)) next.delete(path);
    else next.add(path);
    return next;
  });
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextInput value={query} onChangeText={setQuery} placeholder="Filter by path or title" placeholderTextColor={colors.foregroundMuted} style={{ flex: 1, color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }} />
        <IconButton icon="ChevronsUpDown" label="Expand all" onPress={() => setExpanded(new Set(allFolders(paths)))} />
        <IconButton icon="ChevronsDownUp" label="Collapse all" onPress={() => setExpanded(new Set())} />
      </View>
      {query.trim() && shown.length === 0 ? <T tone="muted">No file matches the filter.</T> : null}
      {rows.map((r) => (
        <Press
          key={r.key}
          label={r.kind === "folder" ? `${r.expanded ? "Collapse" : "Expand"} ${r.name}` : `Open ${r.path}`}
          onPress={() => (r.kind === "folder" ? toggle(r.path) : onOpen({ kind: "file", path: r.path }))}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: r.depth * 14, paddingVertical: 2, backgroundColor: r.kind === "file" && r.path === openPath ? colors.surface2 : "transparent" }}
        >
          <Icon name={r.kind === "folder" ? (r.expanded ? "FolderOpen" : "Folder") : "FileText"} size={14} color={colors.foregroundMuted} />
          <T size={13} lines={1} style={{ flex: 1 }}>{r.name}</T>
          {r.kind === "folder" ? <T size={11} tone="muted">{String(r.count)}</T> : null}
        </Press>
      ))}
    </View>
  );
}

export function SectionTabs<S extends string>({ sections, active, onChange }: { sections: readonly S[]; active: S; onChange: (s: S) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {sections.map((s) => (
        <Chip key={s} label={s} active={s === active} onPress={() => onChange(s)} />
      ))}
    </View>
  );
}
