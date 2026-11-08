import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicCreateFileSync } from "../engine/storage.ts";
import { eventHash, isObject, isSafeTaskId, validEnvelope } from "../engine/envelope.ts";

/** Agent-side writer: publishes only an immutable inbox envelope, never business state. */
export function publishEvent(base: string, input: unknown, now = new Date()) {
  if (!isObject(input) || typeof input.event !== "string" || !isObject(input.payload)) throw new Error("event and object payload required");
  const normalize = (value: unknown) => {
    if (typeof value !== "string" || !/(Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("timestamp must include Z or an explicit timezone offset");
    if (Date.parse(value) > now.getTime() + 60_000) throw new Error("timestamp is in the future; use UTC from the machine clock, not local time with Z");
    return new Date(value).toISOString();
  };
  const taskId = input.taskId ?? `agent-${randomUUID()}`;
  if (!isSafeTaskId(taskId)) throw new Error("unsafe taskId");
  // An exact retry preserves its original timestamp, including a generated one.
  const dest = path.join(base, "data/inbox", `${taskId}.json`);
  const prior = existsSync(dest) ? JSON.parse(readFileSync(dest, "utf8")) : null;
  const payload = { ...input.payload };
  if (input.event === "APPLICATION_SUBMITTED" && payload.appliedAt !== undefined) payload.appliedAt = normalize(payload.appliedAt);
  const envelope = { ...input, taskId, createdAt: input.createdAt === undefined ? prior?.createdAt ?? now.toISOString() : normalize(input.createdAt), payload };
  if (!validEnvelope(envelope)) throw new Error("invalid event envelope");
  if (prior) {
    if (eventHash(prior) !== eventHash(envelope)) throw new Error("taskId conflicts with an existing inbox event");
    return prior as typeof envelope;
  }
  // Do not replay a completed key with newly generated content/timestamps.
  const receipt = path.join(base, "data/receipts", `${taskId}.json`);
  if (existsSync(receipt)) throw new Error("taskId already has a Receipt; read it before retrying");
  if (!atomicCreateFileSync(dest, JSON.stringify(envelope, null, 2) + "\n")) throw new Error("taskId was concurrently published; read the existing event");
  return envelope;
}
