import { createHash } from "node:crypto";

export function isSafeTaskId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 180 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes("..");
}
export function assertSafeTaskId(value: unknown): asserts value is string {
  if (!isSafeTaskId(value)) throw new Error("E_SCHEMA: unsafe taskId");
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function validEnvelope(value: unknown): boolean {
  if (!isObject(value) || !isSafeTaskId(value.taskId) || typeof value.event !== "string" || !value.event ||
      typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || !isObject(value.payload)) return false;
  if (value.baseline !== undefined) {
    if (!isObject(value.baseline) || !Array.isArray(value.baseline.entries) || !value.baseline.entries.every(entry =>
      isObject(entry) && typeof entry.path === "string" && !entry.path.startsWith("/") && !entry.path.includes("\\") && !entry.path.split("/").some(p => p === ".." || p === "." || !p) && typeof entry.exists === "boolean"
    )) return false;
  }
  return value.evidence === undefined || (Array.isArray(value.evidence) && value.evidence.every(e => isObject(e) && typeof e.kind === "string" && typeof e.text === "string"));
}
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (isObject(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, ordered(value[k])]));
  return value;
}
export function eventHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(ordered(value))).digest("hex");
}
