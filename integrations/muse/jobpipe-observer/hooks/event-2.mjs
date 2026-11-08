import { readFileSync, existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
// Muse sanitizes inherited hook environment. Discover only the real parent launch.
const input = JSON.parse(readFileSync(0, "utf8"));
if (typeof input.cwd !== "string" || !path.isAbsolute(input.cwd)) process.exit(0);
const marker = path.join(input.cwd, "data/inbox/.runtime", `muse-${process.ppid}.json`);
if (!existsSync(marker)) process.exit(0); // Other Muse sessions are outside this integration.
const config = JSON.parse(readFileSync(marker, "utf8"));
if (realpathSync(input.cwd) !== realpathSync(config.base)) throw new Error("Muse launch workspace mismatch");
const { handleMuseHook } = await import(pathToFileURL(path.join(config.projectRoot, "lib/agent/muse-hooks.ts")).href);
handleMuseHook("PreToolUse", input, config, config.contextFile);
