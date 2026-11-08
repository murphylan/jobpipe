import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 2 engine state (Doc-00 sections 6.3 and 9).
// data/engine/state.json is the baseline source a later
// ChangeSet is checked against: after every committed poll
// the daemon rewrites it from the current data on disk.
// It is also what the dashboard will read in stage 4 to show
// engine status, so it stays small and factual.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { captureBaseline, type Baseline } from "./baseline.ts";
import { canonicalJson } from "./serialize.ts";

export const STATE_FILES = [
  "muse-settings.json",
  "jobs.json",
  "applications.json",
  "mirror/ledger.csv",
  "resume-versions.json",
  "resume-files",
  "daily.json",
  "daily-targets.json",
  "changelog.json",
  "activity.json", "waiting.json", "muse-live.json", "knowledge.json",
  "profile.json", "quirks.json", "skill.json", "resumes.json", "company-profile.json",
] as const;

export type EngineState = { lastTaskId: string | null; updatedAt: string; baseline: Baseline };

export function statePath(baseDir: string): string {
  return path.join(baseDir, "data", "engine", "state.json");
}

export function writeState(baseDir: string, lastTaskId: string | null, opts: { paths?: readonly string[] } = {}): EngineState {
  const baseline = captureBaseline(baseDir, STATE_FILES);
  const prior = opts.paths ? readState(baseDir) : null;
  if (prior) {
    baseline.entries = baseline.entries.map(entry => {
      if (opts.paths!.includes(entry.path)) return entry;
      return prior.baseline.entries.find(old => old.path === entry.path) ?? entry;
    });
  }
  const state: EngineState = {
    lastTaskId,
    updatedAt: new Date().toISOString(),
    baseline,
  };
  const full = statePath(baseDir);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, canonicalJson(state), "utf-8");
  return state;
}

export function readState(baseDir: string): EngineState | null {
  const full = statePath(baseDir);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as EngineState;
  } catch {
    return null;
  }
}
