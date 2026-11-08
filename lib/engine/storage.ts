import { closeSync, fsyncSync, linkSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

/** Same-directory replacement: readers see either the old or complete new file. */
export function atomicWriteFileSync(file: string, data: string | Uint8Array, _encoding?: string): void {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.${randomUUID()}.tmp`);
  try {
    const fd = openSync(temp, "wx", 0o600);
    try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, file);
    const directory = openSync(dir, "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

/** Publish a complete new inbox file without replacing a concurrent submission. */
export function atomicCreateFileSync(file: string, data: string): boolean {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try {
    atomicWriteFileSync(temp, data);
    try { linkSync(temp, file); } catch (e) { if ((e as NodeJS.ErrnoException).code === "EEXIST") return false; throw e; }
    const directory = openSync(path.dirname(file), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
    return true;
  } finally { try { unlinkSync(temp); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } }
}
