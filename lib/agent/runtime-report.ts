import { mkdirSync, readFileSync, existsSync, rmdirSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { atomicWriteFileSync } from "../engine/storage.ts";
import { isSafeTaskId } from "../engine/envelope.ts";
import { publishEvent } from "./publish.ts";

export type RuntimeReport = { base: string; activityId: string; runId: string; stage: string; title: string; jobId?: string };
/** Shared ordering for the real process wrapper and synchronous Muse hooks. Only inbox writes. */
export function reportRuntime(config: RuntimeReport, key: string, status: string, note: string, extra: Record<string, unknown> = {}, evidence?: { kind: string; text: string }[]) {
  if (!isSafeTaskId(config.runId)) throw new Error("unsafe runId");
  const dir = path.join(config.base, "data/inbox/.runtime", config.runId);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lock = path.join(dir, "lock");
  const deadline = Date.now() + 3000;
  for (;;) {
    try { mkdirSync(lock); break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST" || Date.now() >= deadline) throw new Error("runtime report lock unavailable; stop and inspect reporting");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    const file = path.join(dir, "sequence.json");
    const state: { next: number; seen: string[]; status?: string } = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { next: 0, seen: [] };
    if (key.startsWith("wrapper-pulse-") && state.status === "waiting") return;
    const id = createHash("sha256").update(key).digest("hex");
    if (state.seen.includes(id)) return;
    const event = { taskId: `${config.runId}-${String(state.next).padStart(8, "0")}-${id}`, event: "AGENT_ACTIVITY", ...(evidence ? { evidence } : {}), payload: {
      activityId: config.activityId, runId: config.runId, sequence: state.next, kind: config.stage === "apply" ? "applying" : config.stage === "screening" ? "screening" : "other",
      stage: config.stage, title: config.title, status, note, ...(config.jobId ? { jobId: config.jobId } : {}), ...extra,
    } };
    // A crash after publish but before state replacement is recoverable with this deterministic key.
    if (!existsSync(path.join(config.base, "data/receipts", `${event.taskId}.json`))) publishEvent(config.base, event);
    atomicWriteFileSync(file, JSON.stringify({ next: state.next + 1, seen: [...state.seen, id], status }));
  } finally { rmdirSync(lock); }
}
