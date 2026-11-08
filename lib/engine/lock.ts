import { randomUUID } from "node:crypto";
// Stage 2 single-instance lock (Doc-00 section 9).
// The daemon holds data/.engine.lock while it runs. A second
// daemon must refuse to start, not run alongside. A lock whose
// pid is no longer alive is stale and is reclaimed; a lock
// whose pid is alive (or cannot be checked) blocks startup.
import { closeSync, mkdirSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

export function lockPath(baseDir: string): string {
  return path.join(baseDir, "data", ".engine.lock");
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "ESRCH") return false;
    return true;
  }
}

export function acquireLock(baseDir: string): boolean {
  const full = lockPath(baseDir);
  mkdirSync(path.dirname(full), { recursive: true });
  try {
    const fd = openSync(full, "wx");
    const token = randomUUID();
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token, startedAt: new Date().toISOString() }) + "\n", "utf-8"); } finally { closeSync(fd); }
    held.set(path.resolve(baseDir), token);
    return true;
  } catch {
    // Serialize stale-lock reclamation, then re-read: a contender must never
    // unlink a fresh lock based on a PID it observed before another reclaim.
    const reclaim = `${full}.reclaim`;
    let fd: number;
    try { fd = openSync(reclaim, "wx"); } catch { return false; }
    try {
      const parsed = JSON.parse(readFileSync(full, "utf-8")) as { pid?: unknown };
      if (typeof parsed.pid !== "number" || pidAlive(parsed.pid)) return false;
      unlinkSync(full);
      return acquireLock(baseDir);
    } catch { return false; }
    finally { closeSync(fd); unlinkSync(reclaim); }
  }
}

export function releaseLock(baseDir: string): void {
  const key = path.resolve(baseDir);
  const token = held.get(key);
  if (!token) return;
  try {
    const full = lockPath(baseDir);
    if (!existsSync(full)) return;
    const owner = JSON.parse(readFileSync(full, "utf8"));
    if (owner.pid === process.pid && owner.token === token) unlinkSync(full);
  } finally { held.delete(key); }
}

const held = new Map<string, string>();
export function withEngineLock<T>(baseDir: string, run: () => T): T {
  const key = path.resolve(baseDir);
  if (held.has(key)) return run();
  if (!acquireLock(baseDir)) throw new Error("engine already running: data/.engine.lock is held");
  try { return run(); } finally { releaseLock(baseDir); }
}
