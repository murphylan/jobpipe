// Runtime signals never determine a business outcome. Expiration is a read
// projection, so restarting the engine cannot rewrite historical activity.
export const ACTIVITY_LEASE_MS = 5 * 60_000;
export const LEGACY_ACTIVITY_LEASE_MS = 15 * 60_000;
export const safeId = (id: unknown): id is string =>
  typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && !id.includes("..");
export const validTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

export type RuntimeActivity = {
  status: string; createdAt: string; taskId: string;
  runId?: string; sequence?: number; leaseExpiresAt?: string;
};

export function runtimeStatus(entry: RuntimeActivity, nowMs = Date.now()): string {
  if (entry.status !== "running") return entry.status;
  const expiry = entry.leaseExpiresAt === undefined
    ? Date.parse(entry.createdAt) + LEGACY_ACTIVITY_LEASE_MS
    : Date.parse(entry.leaseExpiresAt);
  return !Number.isFinite(expiry) || nowMs >= expiry ? "interrupted" : "running";
}

/** Throws before any write. Old clients keep working until a task uses run IDs. */
export function checkActivityTransition(
  history: RuntimeActivity[], next: RuntimeActivity, restartOf: unknown,
): void {
  const previous = history.at(-1);
  if (!previous) {
    if (restartOf !== undefined) throw new Error("E_LIFECYCLE: restart target missing");
    return;
  }
  if (Date.parse(next.createdAt) < Date.parse(previous.createdAt))
    throw new Error("E_LIFECYCLE: stale activity timestamp");
  if (next.runId !== previous.runId) {
    if (!next.runId || next.status !== "running" || restartOf !== (previous.runId ?? previous.taskId))
      throw new Error("E_LIFECYCLE: new run requires running and restartOf the latest run/task");
    if (history.some((entry) => entry.runId === next.runId))
      throw new Error("E_LIFECYCLE: a retired runId cannot be reused");
    return;
  }
  if (restartOf !== undefined) throw new Error("E_LIFECYCLE: restart needs a new runId");
  if (previous.status === "done" || previous.status === "failed")
    throw new Error("E_LIFECYCLE: terminal run is closed; start an explicit new run");
  if (next.runId && next.sequence! <= previous.sequence!)
    throw new Error("E_LIFECYCLE: sequence must increase within a run");
}
