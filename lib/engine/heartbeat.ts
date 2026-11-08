import { atomicWriteFileSync } from "./storage.ts";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
export type Heartbeat = { updatedAt: string; status: "running" | "idle" | "error"; pid: number; error?: string };
export type HeartbeatStatus = { status: "online" | "offline" | "missing"; ageMs: number | null; updatedAt: string | null; error?: string };
const STALE_MS = 15000;
const heartbeatPath = (base: string) => path.join(base, "data/engine/heartbeat.json");
export function writeHeartbeat(baseDir: string, status: Heartbeat["status"] = "running", error?: string): Heartbeat {
  const hb: Heartbeat = { updatedAt: new Date().toISOString(), status, pid: process.pid, ...(error ? { error } : {}) };
  atomicWriteFileSync(heartbeatPath(baseDir), JSON.stringify(hb, null, 2) + "\n");
  return hb;
}
export function readHeartbeatStatus(baseDir: string, nowMs = Date.now()): HeartbeatStatus {
  const file = heartbeatPath(baseDir);
  if (!existsSync(file)) return { status: "missing", ageMs: null, updatedAt: null };
  try {
    const hb = JSON.parse(readFileSync(file, "utf8")) as Heartbeat;
    const at = typeof hb?.updatedAt === "string" ? Date.parse(hb.updatedAt) : NaN;
    if (!Number.isFinite(at) || !["running", "idle", "error"].includes(hb.status) || !Number.isInteger(hb.pid) || hb.pid <= 0) return { status: "offline", ageMs: null, updatedAt: null, error: "invalid heartbeat" };
    const ageMs = nowMs - at;
    const error = hb.status === "error" ? hb.error || "engine poll failed" : undefined;
    return { status: hb.status === "running" && !hb.error && ageMs >= 0 && ageMs <= STALE_MS ? "online" : "offline", ageMs, updatedAt: hb.updatedAt, ...(error ? { error } : {}) };
  } catch { return { status: "offline", ageMs: null, updatedAt: null, error: "unreadable heartbeat" }; }
}
