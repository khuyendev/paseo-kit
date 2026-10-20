// Sidebar surface (PANL-20): project picker (shown only with more than one project) plus the planning panel
// of the chosen workspace; the choice and the 5 most recent projects are kept per host across remounts.
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { Chip, KitProvider, Press, StatePanel, T, useKit } from "./kit.tsx";
import { LIST_POLL_MS } from "./nav.ts";
import { PlanningBody } from "./panel.tsx";
import { type RawWorkspace, chosenWorkspace, hostMemory, rememberSelection, searchProjects, showPicker, toProjects } from "./projects.ts";

export function PlanningSurface({ theme, layout, host }: PluginSurfaceProps) {
  return (
    <KitProvider theme={theme} compact={layout.compact}>
      <Picker hostId={host.id} />
    </KitProvider>
  );
}

function Picker({ hostId }: { hostId: string }) {
  const { colors } = useKit();
  const paseo = usePaseo();
  const memory = hostMemory(hostId);
  const [selected, setSelected] = useState({ projectId: memory.projectId, workspaceId: memory.workspaceId });
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["planning-workspaces", hostId],
    queryFn: async () => (await paseo.workspaces.list()).entries as unknown as RawWorkspace[],
    refetchInterval: LIST_POLL_MS,
  });
  const projects = useMemo(() => toProjects(q.data ?? []), [q.data]);
  if (q.isPending) return <StatePanel icon="Loader" busy title="Loading projects" />;
  if (q.isError) return <StatePanel icon="WifiOff" tone="danger" title="Daemon not reachable" body={String(q.error.message)} />;
  if (projects.length === 0) return <StatePanel icon="FolderSearch" title="No workspace" body="Open a project in Paseo first." />;
  const project = projects.find((p) => p.id === selected.projectId) ?? searchProjects(projects, "", memory.recent)[0];
  const workspace = chosenWorkspace(project, selected.workspaceId);
  const choose = (projectId: string, workspaceId: string) => {
    rememberSelection(hostId, projectId, workspaceId);
    setSelected({ projectId, workspaceId });
    setOpen(false);
  };
  return (
    <View style={{ flex: 1 }}>
      <View style={{ gap: 6, padding: 10, borderBottomWidth: 1, borderColor: colors.border }}>
        {showPicker(projects) ? (
          <Press label="Choose project" onPress={() => setOpen((v) => !v)} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="FolderKanban" size={14} color={colors.foregroundMuted} />
            <T size={13} weight="700" lines={1} style={{ flex: 1 }}>
              {project.name}
            </T>
            <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={colors.foregroundMuted} />
          </Press>
        ) : (
          <T size={13} weight="700">{project.name}</T>
        )}
        {open ? (
          <View style={{ gap: 4 }}>
            <TextInput value={query} onChangeText={setQuery} placeholder="Search projects" placeholderTextColor={colors.foregroundMuted} style={{ color: colors.foreground, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }} />
            {searchProjects(projects, query, memory.recent).map((p) => (
              <Press key={p.id} label={`Open ${p.name}`} onPress={() => choose(p.id, p.workspaces[0].id)} style={{ paddingVertical: 3 }}>
                <T size={12} weight={p.id === project.id ? "700" : "400"}>{p.name}</T>
                <T size={10} tone="muted" lines={1}>{p.rootPath}</T>
              </Press>
            ))}
          </View>
        ) : null}
        {project.workspaces.length > 1 ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {project.workspaces.map((w) => (
              <Chip key={w.id} label={w.name} icon={w.workspaceKind === "worktree" ? "GitBranch" : "FolderGit2"} active={w.id === workspace.id} onPress={() => choose(project.id, w.id)} />
            ))}
          </View>
        ) : null}
      </View>
      <PlanningBody key={workspace.id} workspaceId={workspace.id} />
    </View>
  );
}
