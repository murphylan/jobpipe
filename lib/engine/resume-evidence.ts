import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { assertSafeTaskId } from "./envelope.ts";
import { atomicWriteFileSync } from "./storage.ts";

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** SHA-256 of a registered resume file ("data/..." path), or null when it
 * cannot be read safely (missing, symlink, oversized, or escaping the tree). */
export function registeredResumeSha256(baseDir: string, file: unknown): string | null {
  if (typeof file !== "string" || !file.startsWith("data/") || file.includes("..") || file.includes("\\")) return null;
  try {
    const root = realpathSync(baseDir);
    const full = path.join(root, file);
    if (!existsSync(full)) return null;
    const stat = lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024) return null;
    if (realpathSync(full) !== full) return null;
    return sha256Hex(readFileSync(full));
  } catch { return null; }
}

/** New PDF artifacts must originate inside the inbox; old registered references stay untouched. */
export function prepareResumeEvidence(baseDir: string, taskId: string, source: unknown): { file: string; journalPath: string; sha256: string; promote: () => void } {
  assertSafeTaskId(taskId);
  if (typeof source !== "string" || !/^data\/inbox\/evidence\/[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/.test(source) || source.includes("..")) throw new Error("E_EVIDENCE_PATH: PDF must be submitted under data/inbox/evidence/");
  const root = realpathSync(baseDir);
  const full = path.join(root, source);
  const stat = lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 25 * 1024 * 1024 || realpathSync(full) !== full) throw new Error("E_EVIDENCE_PATH: invalid PDF file or symlink");
  const bytes = readFileSync(full);
  if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("E_EVIDENCE_FORMAT: missing PDF header");
  const journalPath = `resume-files/${taskId}.pdf`;
  const dest = path.join(root, "data", journalPath);
  const destDir = path.dirname(dest);
  if (existsSync(destDir) && realpathSync(destDir) !== destDir) throw new Error("E_EVIDENCE_PATH: destination directory is a symlink");
  if (existsSync(dest)) throw new Error("E_EVIDENCE_CONFLICT: destination already exists");
  return { file: `data/${journalPath}`, journalPath, sha256: sha256Hex(bytes), promote: () => atomicWriteFileSync(dest, bytes) };
}
