// Engine-owned promotion. Keep staging until state is durable; archive every
// consumed signal (including stale ones), quarantine invalid input, never
// replace a corrupt canonical file with an empty map.
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { safeId, validTime } from "./activity-lifecycle.ts";

type LiveState = "working" | "waiting_user";
type Cursor = { at: string; state: LiveState | "done" | "failed" };
type LiveEntry = { state: LiveState; detail: string; updatedAt: string };
type MuseLiveFile = { version: number; updatedAt: string; live: Record<string, LiveEntry>; cursors?: Record<string, Cursor> };
const dataDir = (base: string) => join(base, "data");
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function readMuseLive(base: string): MuseLiveFile {
  const file = join(dataDir(base), "muse-live.json");
  if (!existsSync(file)) return { version: 0, updatedAt: "", live: {} };
  const d: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!object(d) || !Number.isSafeInteger(d.version) || Number(d.version) < 0 ||
      typeof d.updatedAt !== "string" || !object(d.live) ||
      Object.values(d.live).some((e) => !object(e) || !["working", "waiting_user"].includes(String(e.state)) ||
        typeof e.detail !== "string" || !validTime(e.updatedAt)) ||
      (d.cursors !== undefined && (!object(d.cursors) || Object.values(d.cursors).some((e) =>
        !object(e) || !validTime(e.at) || !["working", "waiting_user", "done", "failed"].includes(String(e.state))))))
    throw new Error("E_LIVE_CORRUPT: refusing to overwrite invalid muse-live.json");
  return d as MuseLiveFile;
}

function persist(base: string, data: MuseLiveFile): void {
  const file = join(dataDir(base), "muse-live.json");
  const tmp = file + ".tmp";
  const fd = openSync(tmp, "w");
  try {
    writeFileSync(fd, JSON.stringify(data, null, 2) + "\n", "utf8");
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(tmp, file);
  const dir = openSync(dataDir(base), "r");
  try { fsyncSync(dir); } finally { closeSync(dir); }
}

function archive(base: string, file: string, raw: string, mtimeMs: number, error?: string): void {
  const dir = join(dataDir(base), error ? "rejected" : "processed", "muse-live");
  mkdirSync(dir, { recursive: true });
  const id = randomUUID();
  const save = (name: string, text: string) => {
    const fd = openSync(join(dir, name), "wx");
    try { writeFileSync(fd, text, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
  };
  save(`${id}.json`, raw);
  if (error) save(`${id}.error.json`, JSON.stringify({ error, source: file, rejectedAt: new Date().toISOString() }) + "\n");
  const archiveDir = openSync(dir, "r");
  try { fsyncSync(archiveDir); } finally { closeSync(archiveDir); }
  // A producer may already have replaced its overwrite-slot. Do not remove it.
  try {
    if (statSync(file).mtimeMs === mtimeMs && readFileSync(file, "utf8") === raw) unlinkSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

export function processMuseLiveInboxOnce(base: string, opts: { nowMs?: number } = {}): string[] {
  const nowMs = opts.nowMs ?? Date.now();
  const dir = join(dataDir(base), "inbox/muse-live");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  if (!files.length) return [];
  // Fail closed before consuming any input when canonical state is damaged.
  const current = readMuseLive(base);
  const processed: string[] = [];
  for (const name of files) {
    const file = join(dir, name);
    let st;
    try { st = statSync(file); } catch { continue; }
    if (!st.isFile() || nowMs - st.mtimeMs < 1500) continue;
    const raw = readFileSync(file, "utf8");
    if (statSync(file).mtimeMs !== st.mtimeMs) continue;
    let p: unknown;
    try { p = JSON.parse(raw); }
    catch { archive(base, file, raw, st.mtimeMs, "E_PARSE: invalid JSON"); continue; }
    if (!object(p) || !safeId(p.jobId) || !["working", "waiting_user", "done", "failed"].includes(String(p.state)) ||
        (p.detail !== undefined && typeof p.detail !== "string") ||
        (p.createdAt !== undefined && (!validTime(p.createdAt) || Date.parse(p.createdAt) > nowMs))) {
      archive(base, file, raw, st.mtimeMs, "E_SCHEMA: jobId/state/detail/createdAt invalid");
      continue;
    }
    const jobId = p.jobId;
    const at = typeof p.createdAt === "string" ? p.createdAt : new Date(st.mtimeMs).toISOString();
    const cursor = current.cursors?.[jobId];
    const previousAt = cursor?.at ?? current.live[jobId]?.updatedAt;
    if (previousAt && Date.parse(at) === Date.parse(previousAt) && cursor && cursor.state !== p.state) {
      archive(base, file, raw, st.mtimeMs, "E_LIVE_CONFLICT: equal timestamp with different state; resubmit with newer createdAt");
      continue;
    }
    // The cursor survives done, so replay cannot resurrect an older signal.
    if (!previousAt || Date.parse(at) > Date.parse(previousAt)) {
      const live = { ...current.live };
      const state = p.state as Cursor["state"];
      if (state === "done" || state === "failed") delete live[jobId];
      else live[jobId] = { state, detail: typeof p.detail === "string" ? p.detail : "", updatedAt: at };
      const next = { ...current, version: current.version + 1, updatedAt: new Date(nowMs).toISOString(), live,
        cursors: { ...current.cursors, [jobId]: { at, state } } };
      persist(base, next); // Failure leaves input untouched; replay after save is idempotent.
      Object.assign(current, next);
    }
    archive(base, file, raw, st.mtimeMs);
    processed.push(jobId);
  }
  return processed;
}

export function ensureMuseLiveInboxDir(base: string): string {
  const dir = join(dataDir(base), "inbox/muse-live");
  mkdirSync(dir, { recursive: true });
  return dir;
}
