import path from "node:path";
import { readKnowledge, type KnowledgeEntry } from "../knowledge.ts";
import { commitFiles, type EventResult, type GenericChangeSet } from "./events.ts";
import { atomicWriteFileSync } from "./storage.ts";
import { canonicalJson } from "./serialize.ts";

export function applyKnowledgeChanged(baseDir: string, cs: GenericChangeSet): EventResult {
  const p = cs.payload;
  if (!["add", "update", "archive", "reread"].includes(String(p.action))) return { ok: false, errors: ["E_SCHEMA: unknown knowledge action"] };
  if (["add", "update"].includes(String(p.action)) && (typeof p.title !== "string" || !p.title.trim() || typeof p.body !== "string" || !p.body.trim() || !Array.isArray(p.tags) || !p.tags.every(t => typeof t === "string"))) return { ok: false, errors: ["E_SCHEMA: invalid knowledge entry"] };
  if (p.action === "update" && (typeof p.id !== "string" || !p.id || typeof p.expectedUpdatedAt !== "string" || !p.expectedUpdatedAt)) return { ok: false, errors: ["E_SCHEMA: update requires id and expectedUpdatedAt"] };
  if (p.action === "archive" && (typeof p.id !== "string" || typeof p.archived !== "boolean")) return { ok: false, errors: ["E_SCHEMA: invalid archive request"] };
  if (p.taskId !== undefined && typeof p.taskId !== "string") return { ok: false, errors: ["E_SCHEMA: invalid reread taskId"] };
  const result = commitFiles(baseDir, cs.taskId, ["knowledge.json"], () => {
    const data = readKnowledge(baseDir);
    if (p.action === "add" || p.action === "update") {
      const previous = p.action === "update" ? data.entries.find(e => e.id === p.id) : undefined;
      if (p.action === "update" && (!previous || previous.archived || previous.updatedAt !== p.expectedUpdatedAt)) throw new Error("E_CONFLICT: knowledge changed or archived; reload before editing");
      const entry: KnowledgeEntry = { id: `k-${cs.taskId}`, title: (p.title as string).trim(), body: (p.body as string).trim(), tags: p.tags as string[], createdAt: cs.createdAt, updatedAt: cs.createdAt, archived: false };
      if (data.entries.some(e => e.id === entry.id)) throw new Error("E_DUPLICATE: knowledge id exists");
      if (previous) {
        entry.supersedes = previous.id;
        previous.archived = true;
        previous.archivedAt = cs.createdAt;
        previous.updatedAt = cs.createdAt;
      }
      data.entries.unshift(entry);
    } else if (p.action === "archive") {
      const entry = data.entries.find(e => e.id === p.id);
      if (!entry) throw new Error("E_GUARD: knowledge entry not found");
      entry.archived = p.archived as boolean;
      entry.updatedAt = cs.createdAt;
      if (entry.archived) entry.archivedAt = cs.createdAt;
      else delete entry.archivedAt;
    } else {
      data.rereads.push({ at: cs.createdAt, ...(typeof p.taskId === "string" ? { taskId: p.taskId } : {}), count: data.entries.filter(e => !e.archived).length });
    }
    data.version += 1;
    data.updatedAt = cs.createdAt;
    atomicWriteFileSync(path.join(baseDir, "data", "knowledge.json"), canonicalJson(data));
  });
  return result.ok ? { ok: true, summary: `KNOWLEDGE_CHANGED ${String(p.action)}` } : result;
}
