import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
import { chicagoToday } from "../ledger.ts";
// Stage 3 external-modification detection and daily derivation
// (Doc-00 sections 7.5 and 10, shadow-mode prerequisites).
// External modification: anything that changed data/ outside
// the engine shows up as a baseline mismatch against
// data/engine/state.json, which the daemon rewrites after
// every committed poll. A mismatch does not auto-repair
// anything; it is reported so a later shadow report can
// attribute it instead of silently merging over it.
// Daily derivation: only today in daily.json is refreshed from committed run
// records (discovery/screening/tailoring/review by Chicago
// date) plus ledger confirmed rows (apply by submitted date).
// The same derivation serves daemon statistics; historical days remain frozen.
import { existsSync } from "node:fs";
import path from "node:path";
import { checkBaseline } from "./baseline.ts";
import { commitFiles, readJsonFile } from "./events.ts";
import { dailyFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";
import { readState } from "./state.ts";

export function detectExternalModifications(baseDir: string): { stateMissing: boolean; mismatches: string[] } {
  const state = readState(baseDir);
  if (!state) return { stateMissing: true, mismatches: [] };
  const checked = checkBaseline(state.baseline, baseDir);
  return { stateMissing: false, mismatches: checked.mismatches };
}

export { deriveDailyCounts } from "./daily-counts.ts";
import { deriveDailyCounts } from "./daily-counts.ts";

export function deriveDaily(baseDir: string, stamp: string): { ok: boolean; days: Record<string, Record<string, number>>; errors?: string[] } {
  const derived = deriveDailyCounts(baseDir);
  const today = chicagoToday(new Date(stamp));
  let days: Record<string, Record<string, number>> = {};
  const result = commitFiles(baseDir, `derive-daily-${stamp.slice(0, 10)}`, ["daily.json"], () => {
    const dailyPath = path.join(baseDir, "data", "daily.json");
    const old = existsSync(dailyPath) ? dailyFileSchema.safeParse(readJsonFile(dailyPath)) : null;
    if (old && !old.success) throw new Error("daily.json: invalid; refusing to replace history");
    days = { ...(old?.success ? old.data.days : {}), [today]: derived[today] ?? { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 } };
    const version = old?.success ? (old.data as { version: number }).version + 1 : 1;
    writeFileSync(dailyPath, canonicalJson({ days, version, updatedAt: stamp }), "utf-8");
  });
  if (!result.ok) return { ok: false, days, errors: result.errors };
  return { ok: true, days };
}
