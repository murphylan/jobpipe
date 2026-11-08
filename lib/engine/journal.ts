import { readReceipt } from "./receipt.ts";
import { assertSafeTaskId } from "./envelope.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 1 transaction journal (Doc-00 section 9, second cut).
// A journal records, before any change, the exact prior content of
// every file a ChangeSet will touch, under data/.journal/<taskId>.json.
// On failure the engine restores those contents (rollback) and
// deletes the journal; on success it deletes the journal without
// restoring (commit). This is distinct from data/.bak backups
// (lib/backup.ts), which are kept for human recovery; journals
// are transient and must not accumulate.
// Rules enforced here:
// - begin twice for the same taskId throws: a journal must never
//   be silently overwritten, or rollback would restore the wrong state.
// - restore of a file that did not exist before deletes that file.
// - restore and commit both delete the journal file afterwards.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

export type JournalFile = {
  taskId: string;
  createdAt: string;
  files: { path: string; before: string | null }[];
};

function journalPath(baseDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return path.join(baseDir, "data", ".journal", `${taskId}.json`);
}

export function beginJournal(baseDir: string, taskId: string, relPaths: readonly string[]): JournalFile {
  const journalFile = journalPath(baseDir, taskId);
  if (existsSync(journalFile)) {
    throw new Error(`journal already exists for task ${taskId}; refusing to overwrite (rollback state would be lost)`);
  }
  const dataDir = path.join(baseDir, "data");
  const paths = deferred.has(path.resolve(baseDir)) ? [...relPaths, `runs/${taskId}.json`, `receipts/${taskId}.json`, `receipts/${taskId}.md`] : [...relPaths];
  const files = [...new Set(paths)].map((rel) => {
    assertDataPath(rel);
    const full = path.join(dataDir, rel);
    return { path: rel, before: existsSync(full) ? readFileSync(full, "utf-8") : null };
  });
  const journal: JournalFile = { taskId, createdAt: new Date().toISOString(), files };
  mkdirSync(path.dirname(journalFile), { recursive: true });
  writeFileSync(journalFile, JSON.stringify(journal, null, 2) + "\n", "utf-8");
  return journal;
}

export function restoreJournal(baseDir: string, taskId: string): string[] {
  const journalFile = journalPath(baseDir, taskId);
  if (!existsSync(journalFile)) throw new Error(`no journal found for task ${taskId}`);
  const receipt = readReceipt(baseDir, taskId);
  if (receipt && ["committed", "verified"].includes(receipt.status)) { finishJournal(baseDir, taskId); return []; }
  const journal = JSON.parse(readFileSync(journalFile, "utf-8")) as JournalFile;
  const dataDir = path.join(baseDir, "data");
  const restored: string[] = [];
  if (journal.taskId !== taskId || !Array.isArray(journal.files)) throw new Error("invalid journal");
  for (const f of journal.files) {
    assertDataPath(f.path);
    if (f.before !== null && typeof f.before !== "string") throw new Error("invalid journal before image");
  }
  for (const f of journal.files) {
    const full = path.join(dataDir, f.path);
    if (f.before === null) {
      if (existsSync(full)) rmSync(full, { force: true });
    } else {
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, f.before, "utf-8");
    }
    restored.push(f.path);
  }
  rmSync(journalFile, { force: true });
  return restored;
}

export function commitJournal(baseDir: string, taskId: string): void {
  if (deferred.has(path.resolve(baseDir))) return;
  const journalFile = journalPath(baseDir, taskId);
  if (!existsSync(journalFile)) throw new Error(`no journal found for task ${taskId}`);
  rmSync(journalFile, { force: true });
}

// In daemon scope the journal survives handler success until its Receipt is durable.
const deferred = new Set<string>();
export function deferJournalCommit<T>(baseDir: string, run: () => T): T {
  const key = path.resolve(baseDir);
  if (deferred.has(key)) return run();
  deferred.add(key);
  try { return run(); } finally { deferred.delete(key); }
}
export function finishJournal(baseDir: string, taskId: string): void {
  const file = journalPath(baseDir, taskId);
  if (existsSync(file)) rmSync(file);
}
export function recoverJournals(baseDir: string, onCommitted?: (receipt: NonNullable<ReturnType<typeof readReceipt>>) => void): void {
  const dir = path.join(baseDir, "data", ".journal");
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const taskId = file.slice(0, -5);
    assertSafeTaskId(taskId);
    const receipt = readReceipt(baseDir, taskId);
    if (receipt?.taskId === taskId && ["committed", "verified"].includes(receipt.status)) {
      onCommitted?.(receipt);
      finishJournal(baseDir, taskId);
    }
    else restoreJournal(baseDir, taskId);
  }
}

function assertDataPath(rel: string): void {
  if (typeof rel !== "string" || path.isAbsolute(rel) || rel.includes("\\") || rel.split("/").some(p => p === ".." || p === "." || !p)) throw new Error("unsafe journal path");
}
