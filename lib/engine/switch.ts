import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// FR-9: Per-event cutover (P1).
// After M-7 is met for an event, it can be switched to "engine-only writes".
// - Before switch: Muse writes directly, engine does shadow comparison.
// - After switch: Muse must submit via inbox only; direct writes are violations (FR-8).
//
// Switch state is stored in data/engine-switches.json:
// - Each switch records: event, switchedAt, switchedBy, reason, M-7 evidence.
// - Switch-back is individual per event, with its own record.
// - History is preserved (not deleted on switch-back).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./serialize.ts";
import { computeShadowStats } from "./shadow-stats.ts";

export type SwitchRecord = {
  event: string;
  switched: boolean;
  switchedAt: string;
  switchedBy: string;
  reason: string;
  /** M-7 consecutive zero-diffs at switch time (evidence). */
  m7ConsecutiveZeroDiffs?: number;
  /** For switch-back: when it was switched back. */
  switchedBackAt?: string;
  switchedBackBy?: string;
  switchBackReason?: string;
};

export type SwitchFile = {
  version: number;
  updatedAt: string;
  switches: Record<string, SwitchRecord>;
  /** Full history, including switch-backs. */
  history: SwitchRecord[];
};

const SWITCH_FILE = "data/engine-switches.json";

function readSwitchFile(baseDir: string): SwitchFile {
  const full = path.join(baseDir, SWITCH_FILE);
  if (!existsSync(full)) {
    return { version: 1, updatedAt: new Date().toISOString(), switches: {}, history: [] };
  }
  try {
    return JSON.parse(readFileSync(full, "utf-8")) as SwitchFile;
  } catch {
    return { version: 1, updatedAt: new Date().toISOString(), switches: {}, history: [] };
  }
}

function writeSwitchFile(baseDir: string, data: SwitchFile): void {
  const full = path.join(baseDir, SWITCH_FILE);
  data.updatedAt = new Date().toISOString();
  data.version = (data.version ?? 0) + 1;
  writeFileSync(full, canonicalJson(data), "utf-8");
}

/**
 * Check if an event is currently switched to engine-only writes.
 */
export function isSwitched(baseDir: string, event: string): boolean {
  const data = readSwitchFile(baseDir);
  return data.switches[event]?.switched === true;
}

/**
 * List all current switch states.
 */
export function listSwitches(baseDir: string): SwitchRecord[] {
  const data = readSwitchFile(baseDir);
  return Object.values(data.switches).sort((a, b) => a.event.localeCompare(b.event));
}

/**
 * Get the full history of switches and switch-backs.
 */
export function getSwitchHistory(baseDir: string): SwitchRecord[] {
  const data = readSwitchFile(baseDir);
  return [...data.history].sort((a, b) => (b.switchedAt ?? "").localeCompare(a.switchedAt ?? ""));
}

export type SwitchResult =
  | { ok: true; record: SwitchRecord }
  | { ok: false; error: string };

/**
 * Switch an event to engine-only writes.
 * Requires M-7 to be met (checked via shadow-stats).
 * @param event - the event name (e.g. "APPLICATION_SUBMITTED")
 * @param switchedBy - who initiated the switch (e.g. "user")
 * @param reason - why (e.g. "M-7 met, manual cutover")
 */
export function switchEvent(baseDir: string, event: string, switchedBy: string, reason: string): SwitchResult {
  const data = readSwitchFile(baseDir);
  if (data.switches[event]?.switched === true) {
    return { ok: false, error: `${event} is already switched` };
  }
  // FR-9: M-7 must be met before cutover.
  const stats = computeShadowStats(baseDir);
  const eventStats = stats.events.find((e) => e.event === event);
  if (!eventStats) {
    return { ok: false, error: `${event} has no shadow reports; run shadow comparisons first` };
  }
  if (!eventStats.met) {
    return {
      ok: false,
      error: `${event} M-7 not met: ${eventStats.consecutiveZeroDiff}/${eventStats.required} consecutive zero-diffs`,
    };
  }
  const record: SwitchRecord = {
    event,
    switched: true,
    switchedAt: new Date().toISOString(),
    switchedBy,
    reason,
    m7ConsecutiveZeroDiffs: eventStats.consecutiveZeroDiff,
  };
  data.switches[event] = record;
  data.history.push({ ...record });
  writeSwitchFile(baseDir, data);
  return { ok: true, record };
}

/**
 * Switch an event back to allow direct writes (undo the cutover).
 * Individual per event; history is preserved.
 */
export function switchBackEvent(baseDir: string, event: string, switchedBy: string, reason: string): SwitchResult {
  const data = readSwitchFile(baseDir);
  const current = data.switches[event];
  if (!current || current.switched !== true) {
    return { ok: false, error: `${event} is not currently switched` };
  }
  const record: SwitchRecord = {
    ...current,
    switched: false,
    switchedBackAt: new Date().toISOString(),
    switchedBackBy: switchedBy,
    switchBackReason: reason,
  };
  data.switches[event] = record;
  data.history.push({ ...record });
  writeSwitchFile(baseDir, data);
  return { ok: true, record };
}
