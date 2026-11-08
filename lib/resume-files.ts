import fs from "node:fs";
import path from "node:path";

export type ResolveResult = { ok: true; file: string } | { ok: false; reason: "invalid" | "not-found" };

/**
 * Validate a ?path= value against the data/resume-files whitelist.
 * Only a bare "<name>.pdf" filename is accepted — no traversal, no subdirs, no other extensions.
 */
export function resolveResumeFile(baseDir: string, requested: string | null): ResolveResult {
  if (
    !requested ||
    requested.includes("..") ||
    requested.includes("/") ||
    requested.includes("\\") ||
    !requested.endsWith(".pdf")
  ) {
    return { ok: false, reason: "invalid" };
  }
  const dir = path.join(baseDir, "data/resume-files");
  const file = path.join(dir, path.basename(requested));
  if (!file.startsWith(dir + path.sep)) return { ok: false, reason: "invalid" };
  if (!fs.existsSync(file)) return { ok: false, reason: "not-found" };
  return { ok: true, file };
}
