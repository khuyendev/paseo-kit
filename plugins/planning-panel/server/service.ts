// The four planning RPC handlers (PANL-04, PANL-11..16). Each resolves the workspace directory, reads
// `.planning/` with node:fs only (PANL-05) and returns an envelope; nothing throws to the host.
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { type Board, type FileDetail, type PlanDetail, type PlanningFailure, type PlanningIndex, summaryDone } from "../shared/planning.ts";
import { boardColumns, boardPhase } from "./board.ts";
import { type Paseo, PlanningError, planningRoot, resolveInPlanning, toFailure, workspaceDirectory } from "./common.ts";
import { properties, parsePlan, parseSummary, readDocument } from "./documents.ts";
import { parseFrontmatter } from "./frontmatter.ts";
import { LadderStatusSource, type StatusSource } from "./gsd-link.ts";
import { PlanningIndexer } from "./indexer.ts";
import { classify } from "./kinds.ts";
import { phaseRoster } from "./ladder.ts";

export class PlanningService {
  readonly indexer: PlanningIndexer;
  private readonly statuses: StatusSource;

  constructor(statuses: StatusSource = new LadderStatusSource(), indexer = new PlanningIndexer()) {
    this.statuses = statuses;
    this.indexer = indexer;
  }

  private async guard<T>(paseo: Paseo, workspaceId: string, work: (dir: string) => Promise<T>): Promise<T | PlanningFailure> {
    let dir: string | null = null;
    try {
      dir = await workspaceDirectory(paseo, workspaceId);
      return await work(dir);
    } catch (err) {
      return toFailure(err, dir);
    }
  }

  private async buildIndex(workspaceId: string, directory: string): Promise<PlanningIndex> {
    const root = await planningRoot(directory);
    const result = await this.indexer.index(root);
    let statusError: string | null = null;
    const raw = phaseRoster(directory).map(({ id, name, dir }) => ({ id, name, dir }));
    let fn: Awaited<ReturnType<StatusSource["forWorkspace"]>> | null = null;
    try {
      fn = await this.statuses.forWorkspace(directory);
    } catch (err) {
      statusError = err instanceof Error ? err.message : String(err);
    }
    const phases = await Promise.all(
      raw.map(async (p) => {
        if (!fn) return { ...p, status: null };
        if (p.dir === null) return { ...p, status: "NOT_STARTED" as const };
        try {
          return { ...p, status: await fn(join(root, p.dir)) };
        } catch (err) {
          statusError ??= `phase ${p.id}: ${err instanceof Error ? err.message : String(err)}`;
          return { ...p, status: null };
        }
      }),
    );
    return { ok: true, workspaceId, directory, scope: result.scope, total: result.total, unreadable: result.unreadable, statusError, files: result.files, phases };
  }

  index(paseo: Paseo, { workspaceId }: { workspaceId: string }) {
    return this.guard(paseo, workspaceId, (dir) => this.buildIndex(workspaceId, dir));
  }

  board(paseo: Paseo, { workspaceId }: { workspaceId: string }) {
    return this.guard(paseo, workspaceId, async (dir): Promise<Board> => {
      const idx = await this.buildIndex(workspaceId, dir);
      const phases = idx.phases.map((p) => boardPhase(p, idx.files, idx.scope));
      return { ok: true, workspaceId, directory: dir, scope: idx.scope, statusError: idx.statusError, ...boardColumns(phases) };
    });
  }

  plan(paseo: Paseo, { workspaceId, planId }: { workspaceId: string; planId: string }) {
    return this.guard(paseo, workspaceId, async (dir): Promise<PlanDetail> => {
      const root = await planningRoot(dir);
      const { files, unreadable } = await this.indexer.index(root);
      const planFile = files.find((f) => f.kind === "plan" && f.planId === planId);
      // A partial listing cannot tell a missing plan from one in a directory that could not be read (G197).
      if (!planFile && unreadable) throw new PlanningError("unreadable", `could not read ${unreadable} in .planning/, so plan ${planId} cannot be looked up`);
      if (!planFile) throw new PlanningError("not_found", `no plan ${planId} in .planning/`);
      const planDoc = await readDocument(await resolveInPlanning(root, planFile.path));
      const parsed = parsePlan(planDoc.text);
      if ("error" in parsed) throw new PlanningError("parse_error", `${planFile.path}:${parsed.line}: ${parsed.error}`);
      // The SUMMARY is the plan's exact sibling, never a retired copy under superseded/ (CR-PNL-05).
      const summaryPath = planFile.path.replace(/-PLAN\.md$/i, "-SUMMARY.md");
      const summaryFile = files.find((f) => f.kind === "summary" && f.path.toLowerCase() === summaryPath.toLowerCase());
      let summary: PlanDetail["summary"] = null;
      let truncated = planDoc.truncated;
      if (summaryFile) {
        const summaryDoc = await readDocument(await resolveInPlanning(root, summaryFile.path));
        const s = parseSummary(summaryDoc.text);
        if ("error" in s) throw new PlanningError("parse_error", `${summaryFile.path}:${s.line}: ${s.error}`);
        summary = { path: summaryFile.path, status: s.status, done: summaryDone(s.status), text: s.text, keyFiles: s.keyFiles };
        truncated ||= summaryDoc.truncated;
      }
      return { ok: true, workspaceId, directory: dir, planId, path: planFile.path, phase: planFile.phase ?? "", ...parsed, summary, truncated };
    });
  }

  file(paseo: Paseo, { workspaceId, path }: { workspaceId: string; path: string }) {
    return this.guard(paseo, workspaceId, async (dir): Promise<FileDetail> => {
      const root = await planningRoot(dir);
      const abs = await resolveInPlanning(root, path);
      const rel = path.replace(/\\/g, "/").replace(/^\.\//, "");
      let doc;
      let mtimeMs;
      try {
        doc = await readDocument(abs);
        mtimeMs = (await fs.stat(abs)).mtimeMs;
      } catch (err) {
        throw new PlanningError("unreadable", `${rel}: ${err instanceof Error ? err.message : String(err)}`);
      }
      const fm = parseFrontmatter(doc.text);
      const base = { ok: true as const, workspaceId, directory: dir, path: rel, kind: classify(rel).kind, mtimeMs, truncated: doc.truncated };
      if ("error" in fm) return { ...base, frontmatter: null, properties: [], error: { message: fm.error, line: fm.line }, body: doc.text };
      return { ...base, frontmatter: fm.data, properties: properties(fm.data), error: null, body: fm.body };
    });
  }
}
