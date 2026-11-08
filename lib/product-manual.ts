import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";

/** The product manual ships with the project: docs/product-manual.md is the single source of truth. */
export const PRODUCT_MANUAL_PATH = path.join("docs", "product-manual.md");

/** Read the bundled product manual in the serving process, including isolated SSR workers. */
export function readProductManual(projectRoot = process.cwd()): string | null {
  try {
    return readFileSync(path.join(projectRoot, PRODUCT_MANUAL_PATH), "utf8");
  } catch { return null; }
}

/** Hash content, never the source path, so manual edits invalidate snapshot caching. */
export function productManualFingerprint(content: string | null): string {
  return content === null ? "manual-unavailable" : `manual-${createHash("sha256").update(content).digest("hex")}`;
}
