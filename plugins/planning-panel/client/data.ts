// Planning queries (PANL-07): lists and the open detail poll every LIST_POLL_MS and keep previous data on a refetch
// error, so an open plan or file follows edits and new SUMMARY files (CR-PNL-08).
import { useRpc } from "@getpaseo/plugin/client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { PlanningIndex } from "../shared/planning.ts";
import { planningBoardRpc, planningFileRpc, planningIndexRpc, planningPlanRpc } from "../shared/planning.ts";
import type { LinkContext } from "./markdown.ts";
import { LIST_POLL_MS } from "./nav.ts";

export function useIndex(workspaceId: string) {
  const rpc = useRpc(planningIndexRpc);
  return useQuery({ queryKey: ["planning-index", workspaceId], queryFn: () => rpc({ workspaceId }), refetchInterval: LIST_POLL_MS, placeholderData: keepPreviousData });
}

export function useBoard(workspaceId: string) {
  const rpc = useRpc(planningBoardRpc);
  return useQuery({ queryKey: ["planning-board", workspaceId], queryFn: () => rpc({ workspaceId }), refetchInterval: LIST_POLL_MS, placeholderData: keepPreviousData });
}

export function usePlan(workspaceId: string, planId: string) {
  const rpc = useRpc(planningPlanRpc);
  return useQuery({ queryKey: ["planning-plan", workspaceId, planId], queryFn: () => rpc({ workspaceId, planId }), refetchInterval: LIST_POLL_MS, placeholderData: keepPreviousData });
}

export function useFile(workspaceId: string, path: string) {
  const rpc = useRpc(planningFileRpc);
  return useQuery({ queryKey: ["planning-file", workspaceId, path], queryFn: () => rpc({ workspaceId, path }), refetchInterval: LIST_POLL_MS, placeholderData: keepPreviousData });
}

export function linkContext(index: PlanningIndex | null, from: string): LinkContext {
  const files = new Set(index?.files.map((f) => f.path) ?? []);
  const ids = new Set<string>();
  for (const p of index?.phases ?? []) ids.add(`Phase ${Number(p.id.split(".")[0])}${p.id.includes(".") ? `.${p.id.split(".").slice(1).join(".")}` : ""}`);
  for (const f of index?.files ?? []) {
    if (f.kind === "plan" && f.planId) ids.add(f.planId);
    for (const r of f.requirements) ids.add(r);
  }
  return { from, files, ids };
}
