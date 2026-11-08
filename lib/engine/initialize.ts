import { existsSync, readdirSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { COLS } from "../ledger.ts";
import { withEngineLock } from "./lock.ts";
import { atomicCreateFileSync } from "./storage.ts";
import { canonicalJson } from "./serialize.ts";
import { validateDataDir } from "./validate.ts";

/** Fresh installations only. Never repairs, resets or imports an existing business workspace. */
export function initializeWorkspace(baseDir: string): { created: string[] } {
  return withEngineLock(baseDir, () => {
    const dataDir = path.join(baseDir, "data");
    if (readdirSync(dataDir).some(name => name !== ".engine.lock")) throw new Error("Workspace is not empty; initialization refused. Existing data was not changed.");
    const git = spawnSync("git", ["--version"], { encoding: "utf8" });
    if (git.status !== 0) throw new Error("Git is required to initialize a workspace.");
    const stamp = new Date().toISOString(), meta = { version: 1, updatedAt: stamp };
    const json: Record<string, object> = {
      "jobs.json": { ...meta, jobs: [] }, "applications.json": { ...meta, applications: [] },
      "resume-versions.json": { ...meta, versions: [], selected: {} }, "resumes.json": { ...meta, blocks: [] },
      "profile.json": { ...meta }, "quirks.json": { ...meta, quirks: [] },
      "skill.json": { ...meta, skillVersion: "1", changelog: [], dependencies: [] },
      "daily.json": { ...meta, days: {} }, "daily-targets.json": { ...meta, targets: {} },
      "knowledge.json": { ...meta, entries: [], rereads: [] },
      "activity.json": { ...meta, activities: [] }, "waiting.json": { ...meta, items: [] },
      "plans.json": { ...meta, plans: [] }, "checkpoints.json": { ...meta, checkpoints: [] },
      "attempts.json": { ...meta, attempts: [] }, "muse-live.json": { ...meta, live: {} },
      "changelog.json": { entries: [{ at: stamp, action: "workspace-initialized", target: "data/", version: 1, note: "Created empty workspace; no personal facts or sample business records imported." }] },
    };
    const created: string[] = [];
    try {
      for (const [name, value] of Object.entries(json)) {
        if (!atomicCreateFileSync(path.join(dataDir, name), canonicalJson(value))) throw new Error(`File appeared during initialization: ${name}`);
        created.push(name);
      }
      if (!atomicCreateFileSync(path.join(dataDir, "mirror/ledger.csv"), COLS.join(",") + "\n")) throw new Error("Ledger appeared during initialization");
      created.push("mirror/ledger.csv");
      const result = validateDataDir(baseDir);
      if (result.errors.length) throw new Error(result.errors.join("; "));
    } catch (error) {
      for (const name of created) unlinkSync(path.join(dataDir, name));
      throw error;
    }
    for (const directory of ["inbox/decisions", "inbox/evidence", "receipts", "runs", "resume-files"]) mkdirSync(path.join(dataDir, directory), { recursive: true, mode: 0o700 });
    // A nested local Git repo keeps ignored private business records out of the source repo.
    const initialized = spawnSync("git", ["init", "-b", "main", dataDir], { encoding: "utf8" });
    if (initialized.status !== 0 || !existsSync(path.join(dataDir, ".git"))) throw new Error("Empty workspace files created, but private Git initialization failed. Run git init data before starting Engine.");
    return { created };
  });
}
