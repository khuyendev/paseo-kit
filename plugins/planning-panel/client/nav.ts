// Workspace panel navigation (PANL-21) and the stale-response guard (PANL-16, PANL-17).

export const SECTIONS = ["Roadmap", "Phases", "Files"] as const;
export type Section = (typeof SECTIONS)[number];

export type Item = { kind: "plan"; id: string } | { kind: "file"; path: string };

export const LIST_POLL_MS = 5000;
export const TICK_MS = 30_000;
export const SPLIT_MIN_WIDTH = 960;

const same = (a: Item, b: Item) => a.kind === b.kind && (a.kind === "plan" ? a.id === (b as { id: string }).id : a.path === (b as { path: string }).path);

export type TrailAction = { type: "select"; item: Item } | { type: "link"; item: Item } | { type: "back" } | { type: "close" };

// select resets the trail, a followed link pushes (no duplicate of the top), back pops, close clears.
export function trailReducer(trail: readonly Item[], action: TrailAction): Item[] {
  switch (action.type) {
    case "select":
      return [action.item];
    case "link": {
      const top = trail[trail.length - 1];
      return top && same(top, action.item) ? [...trail] : [...trail, action.item];
    }
    case "back":
      return trail.slice(0, -1);
    case "close":
      return [];
  }
}

export function splitView(compact: boolean, width: number): boolean {
  return !compact && width >= SPLIT_MIN_WIDTH;
}

// A detail body is shown only when the response is for exactly what is open now (workspace, path and plan id),
// so a delayed answer for the previous item or another worktree never shows its body.
export function responseMatches(
  want: { workspaceId: string; planId?: string; path?: string },
  got: { ok: boolean; workspaceId?: string; planId?: string; path?: string } | undefined,
): boolean {
  if (!got || !got.ok || got.workspaceId !== want.workspaceId) return false;
  if (want.planId !== undefined && got.planId !== want.planId) return false;
  return want.path === undefined || got.path === want.path;
}

export function liveText(failed: boolean, updatedAtMs: number, clock: (ms: number) => string): string {
  return failed ? "Reconnecting" : `Live · ${clock(updatedAtMs)}`;
}

// What a detail pane shows (PANL-16, PANL-17, CR-PNL-08): the body only for a matching ok response (stale when the
// latest refetch failed, so cached text is marked), a typed failure, an unreachable daemon with retry, or loading.
export type DetailView = { state: "ready"; stale: boolean } | { state: "failure" } | { state: "unreachable" } | { state: "loading" };

export function detailView(q: { data: { ok: boolean } | undefined; isError: boolean; isPlaceholderData: boolean }, matches: boolean): DetailView {
  const d = q.data;
  if (d && !q.isPlaceholderData) {
    if (!d.ok) return { state: "failure" };
    if (matches) return { state: "ready", stale: q.isError };
  }
  return q.isError ? { state: "unreachable" } : { state: "loading" };
}

// The Phases section, all phases or the one a board card opened (CR-PNL-09: a card never opens its folder as a file).
export function phasesShown<P extends { id: string }>(phases: readonly P[], focus: string | null): P[] {
  const one = focus === null ? [] : phases.filter((p) => p.id === focus);
  return one.length ? one : [...phases];
}
