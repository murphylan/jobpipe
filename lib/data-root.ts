import path from "node:path";
import os from "node:os";
/** PIPELINE_DIR is always the project root containing data/. */
export function dataRoot(): string {
  const root = process.env.PIPELINE_DIR || process.cwd();
  return path.resolve(root.startsWith("~/") ? path.join(os.homedir(), root.slice(2)) : root);
}
