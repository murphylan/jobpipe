import { randomUUID } from "node:crypto";
import path from "node:path";
import { atomicWriteFileSync } from "./engine/storage.ts";
import { isObject } from "./engine/envelope.ts";

export function enqueueKnowledge(baseDir: string, body: unknown, archive = false): { taskId: string; queued: true } | null {
  if (!isObject(body)) return null;
  let payload: Record<string, unknown>;
  if (archive) {
    if (typeof body.id !== "string" || !body.id || typeof body.archived !== "boolean") return null;
    payload = { action: "archive", id: body.id, archived: body.archived };
  } else if (body.action === "reread") {
    if (body.taskId !== undefined && typeof body.taskId !== "string") return null;
    payload = { action: "reread", ...(body.taskId === undefined ? {} : { taskId: body.taskId }) };
  } else {
    if (body.action !== undefined && body.action !== "add" && body.action !== "update") return null;
    if (typeof body.title !== "string" || !body.title.trim() || typeof body.body !== "string" || !body.body.trim()) return null;
    if (body.tags !== undefined && (!Array.isArray(body.tags) || !body.tags.every(t => typeof t === "string"))) return null;
    if (body.action === "update" && (typeof body.id !== "string" || !body.id || typeof body.expectedUpdatedAt !== "string" || !body.expectedUpdatedAt)) return null;
    payload = { action: body.action ?? "add", title: body.title, body: body.body, tags: body.tags ?? [], ...(body.action === "update" ? { id: body.id, expectedUpdatedAt: body.expectedUpdatedAt } : {}) };
  }
  const taskId = `knowledge-${randomUUID()}`;
  atomicWriteFileSync(path.join(baseDir, "data", "inbox", `${taskId}.json`), JSON.stringify({ taskId, event: "KNOWLEDGE_CHANGED", createdAt: new Date().toISOString(), payload }) + "\n");
  return { taskId, queued: true };
}
