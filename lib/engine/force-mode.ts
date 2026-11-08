import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// FR-8: External modification force mode (P1).
// When force mode is ON and external modifications are detected,
// the daemon rejects ChangeSets whose event writes to the modified files.
//
// Force mode state: data/engine-force-mode.json { enabled: boolean, updatedAt, reason }
// Detection: detectExternalModifications() from external.ts (baseline mismatch).
// File mapping: registry.yaml `writes` list per event (FR-3).
//
// Mismatch strings look like "data/jobs.json: content changed (sha256 mismatch)".
// We extract the file path (before the first ": ") and match against registry writes.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { detectExternalModifications } from "./external.ts";
import { getRegistryEvent } from "./expand.ts";
import { canonicalJson } from "./serialize.ts";

export type ForceModeState = {
  enabled: boolean;
  updatedAt: string;
  reason: string;
  enabledBy?: string;
};

const FORCE_MODE_FILE = "data/engine-force-mode.json";

function readForceMode(baseDir: string): ForceModeState {
  const full = path.join(baseDir, FORCE_MODE_FILE);
  if (!existsSync(full)) {
    return { enabled: false, updatedAt: new Date().toISOString(), reason: "default off" };
  }
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as ForceModeState;
  } catch {
    throw new Error("E_FORCE_MODE_CORRUPT: refusing to disable write protection");
  }
}

function writeForceMode(baseDir: string, state: ForceModeState): void {
  const full = path.join(baseDir, FORCE_MODE_FILE);
  state.updatedAt = new Date().toISOString();
  writeFileSync(full, canonicalJson(state), "utf-8");
}

/**
 * Check if force mode is enabled.
 */
export function isForceModeEnabled(baseDir: string): boolean {
  return readForceMode(baseDir).enabled;
}

/**
 * Enable force mode.
 */
export function enableForceMode(baseDir: string, by: string, reason: string): void {
  writeForceMode(baseDir, { enabled: true, updatedAt: new Date().toISOString(), reason, enabledBy: by });
}

/**
 * Disable force mode.
 */
export function disableForceMode(baseDir: string, by: string, reason: string): void {
  writeForceMode(baseDir, { enabled: false, updatedAt: new Date().toISOString(), reason, enabledBy: by });
}

/**
 * Extract file paths from mismatch strings.
 * Mismatch format: "<path>: <description>" e.g. "data/jobs.json: content changed (sha256 mismatch)".
 */
export function extractModifiedFiles(mismatches: string[]): string[] {
  const files: string[] = [];
  for (const m of mismatches) {
    const idx = m.indexOf(": ");
    if (idx > 0) {
      const file = m.slice(0, idx);
      files.push(file.startsWith("data/") ? file : `data/${file}`);
    }
  }
  return [...new Set(files)]; // dedupe
}

export type ForceModeCheck =
  | { blocked: false }
  | { blocked: true; reason: string; modifiedFiles: string[]; eventWrites: string[] };

/**
 * Check if a ChangeSet should be blocked by force mode.
 * @param baseDir - the project base directory
 * @param event - the ChangeSet event name
 * @returns blocked=true with details if the event writes to externally-modified files.
 */
export function checkForceMode(baseDir: string, event: string): ForceModeCheck {
  if (!isForceModeEnabled(baseDir)) {
    return { blocked: false };
  }
  const { mismatches } = detectExternalModifications(baseDir);
  if (mismatches.length === 0) {
    return { blocked: false };
  }
  const modifiedFiles = extractModifiedFiles(mismatches);
  // Get the event's writes list from registry.
  const eventDef = getRegistryEvent(baseDir, event);
  if (!eventDef) {
    // Unknown event: block conservatively in force mode.
    return {
      blocked: true,
      reason: `E_FORCE_MODE: ${event} not in registry, blocked while external modifications exist`,
      modifiedFiles,
      eventWrites: [],
    };
  }
  const eventWrites = eventDef.writes ?? [];
  // Check for overlap.
  const overlap = eventWrites.filter((w) => modifiedFiles.includes(w));
  if (overlap.length > 0) {
    return {
      blocked: true,
      reason: `E_FORCE_MODE: external modification detected on ${overlap.join(", ")}; ${event} blocked until resolved`,
      modifiedFiles,
      eventWrites,
    };
  }
  return { blocked: false };
}
