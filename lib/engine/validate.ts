// Stage 1 engine validation (Doc-00 section 9, second cut).
// This migrates scripts/validate-data.mjs into TypeScript on top of
// lib/engine/schema.ts. The .mjs script is NOT deleted or changed
// here; the two must agree until the engine replaces it.
// Differences from the .mjs script, all deliberate:
// - Jobs/applications/daily/changelog go through Zod schemas, so
//   field-level errors are reported, not just missing arrays.
// - Ledger 18-field rows are reported as knownDrift, never as a
//   pass and never as an error that blocks an otherwise valid run.
// - Results are returned as data, not printed and not process.exit,
//   so the engine and tests can act on them.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";
import { chicagoToday } from "../ledger.ts";
import {
  activityFileSchema,
  applicationsFileSchema,
  attemptFileSchema,
  checkLedgerFieldCount,
  checkpointFileSchema,
  dailyFileSchema,
  jobsFileSchema,
  planFileSchema,
  waitingFileSchema,
} from "./schema.ts";

export type DataSource = "real" | "sample" | "missing" | "corrupt";
export type ValidationIssue = {
  level: "error" | "warning" | "knownDrift";
  message: string;
};
export type ValidationResult = {
  errors: string[];
  warnings: string[];
  knownDrift: string[];
  sources: Record<string, DataSource>;
};

type Loaded = { data: unknown; source: DataSource };

function loadJsonWithSource(baseDir: string, rel: string): Loaded {
  const dataDir = path.join(baseDir, "data");
  const realPath = path.join(dataDir, rel);
  const samplePath = path.join(dataDir, "sample", rel);
  if (existsSync(realPath)) {
    try {
      return { data: JSON.parse(readFileSync(realPath, "utf-8")), source: "real" };
    } catch (e) {
      return { data: undefined, source: "corrupt" };
    }
  }
  if (existsSync(samplePath)) {
    try {
      return { data: JSON.parse(readFileSync(samplePath, "utf-8")), source: "sample" };
    } catch {
      return { data: undefined, source: "corrupt" };
    }
  }
  return { data: undefined, source: "missing" };
}

function zodErrors(label: string, issues: { path: readonly unknown[]; message: string }[]): string[] {
  return issues.map((i) => `${label}: ${i.path.map((p) => String(p)).join(".") || "(root)"} ${i.message}`);
}

export function validateDataDir(baseDir: string, today: string = chicagoToday()): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const knownDrift: string[] = [];
  const sources: Record<string, DataSource> = {};
  const dataDir = path.join(baseDir, "data");

  const jobsLoaded = loadJsonWithSource(baseDir, "jobs.json");
  sources["jobs.json"] = jobsLoaded.source;
  let jobIds: Set<string> | null = null;
  if (jobsLoaded.source === "corrupt") errors.push("jobs.json: real file is corrupt");
  else if (jobsLoaded.source === "missing") warnings.push("jobs.json: missing");
  else {
    if (jobsLoaded.source === "sample") warnings.push("jobs.json: using sample data, not real data");
    const parsed = jobsFileSchema.safeParse(jobsLoaded.data);
    if (!parsed.success) errors.push(...zodErrors("jobs.json", parsed.error.issues));
    else jobIds = new Set(parsed.data.jobs.map((j) => j.id));
  }

  // Applications: like validate-data.mjs, a missing real file is a
  // warning and must NOT silently fall back to sample data.
  const appsRealPath = path.join(dataDir, "applications.json");
  let appsLoaded: Loaded;
  if (existsSync(appsRealPath)) {
    appsLoaded = loadJsonWithSource(baseDir, "applications.json");
  } else {
    warnings.push("applications.json: real file missing, not falling back to sample");
    appsLoaded = { data: undefined, source: "missing" };
  }
  sources["applications.json"] = appsLoaded.source;
  if (appsLoaded.source === "corrupt") errors.push("applications.json: real file is corrupt");
  else if (appsLoaded.source === "real" || appsLoaded.source === "sample") {
    const parsed = applicationsFileSchema.safeParse(appsLoaded.data);
    if (!parsed.success) errors.push(...zodErrors("applications.json", parsed.error.issues));
    else if (jobIds) {
      const orphans = parsed.data.applications.filter((a) => !jobIds!.has(a.jobId));
      if (orphans.length)
        errors.push(`applications.json: ${orphans.length} orphan application(s): ${orphans.map((a) => a.jobId).join(", ")}`);
    }
  }

  const mirrorLedger = path.join(dataDir, "mirror/ledger.csv");
  const sampleLedger = path.join(dataDir, "sample/ledger.csv");
  let ledgerPath: string | null = null;
  let ledgerSource: DataSource = "missing";
  if (existsSync(mirrorLedger)) { ledgerPath = mirrorLedger; ledgerSource = "real"; }
  else if (existsSync(sampleLedger)) { ledgerPath = sampleLedger; ledgerSource = "sample"; }
  sources["ledger.csv"] = ledgerSource;
  if (ledgerPath) {
    const rows = parseCsv(readFileSync(ledgerPath, "utf-8").replace(/^\uFEFF/, "").trim());
    if (rows.length) {
      const header = rows[0];
      const ci = (name: string) => header.indexOf(name);
      const dateIdx = ci("date_submitted");
      const statusIdx = ci("submission_status");
      if (dateIdx < 0 || statusIdx < 0) {
        errors.push("ledger.csv: header is missing date_submitted or submission_status");
      } else {
        let confirmedToday = 0;
        for (const cols of rows.slice(1)) {
          const check = checkLedgerFieldCount(cols);
          if (!check.ok) errors.push(`ledger.csv: ${check.reason}`);
          else if (check.knownDrift) knownDrift.push("ledger.csv: 18-field row (historical drift, notes shifted into jd_snapshot_path)");
          if (cols[dateIdx] === today && cols[statusIdx] === "confirmed") confirmedToday++;
        }
        const dailyLoaded = loadJsonWithSource(baseDir, "daily.json");
        sources["daily.json"] = dailyLoaded.source;
        if (dailyLoaded.source === "real" || dailyLoaded.source === "sample") {
          const parsed = dailyFileSchema.safeParse(dailyLoaded.data);
          if (!parsed.success) errors.push(...zodErrors("daily.json", parsed.error.issues));
          else if (parsed.data.days[today]) {
            const applyCount = parsed.data.days[today].apply || 0;
            if (applyCount !== confirmedToday)
              errors.push(`daily.json apply=${applyCount} does not match ledger confirmed=${confirmedToday} for ${today} (rule 17)`);
          }
        }
      }
    }
  } else {
    warnings.push("ledger.csv: missing, skipping reconciliation");
  }

  // Activity console (Doc-07): missing files are fine (not yet
  // created); a present but corrupt or schema-invalid file is
  // an error, so the board shows a red banner instead of
  // silently rendering an empty feed.
  for (const rel of ["activity.json", "waiting.json", "plans.json", "checkpoints.json", "attempts.json"]) {
    const full = path.join(dataDir, rel);
    if (!existsSync(full)) { sources[rel] = "missing"; continue; }
    try {
      const schema = rel === "activity.json" ? activityFileSchema : rel === "plans.json" ? planFileSchema : rel === "checkpoints.json" ? checkpointFileSchema : rel === "attempts.json" ? attemptFileSchema : waitingFileSchema;
      const parsed = schema.safeParse(JSON.parse(readFileSync(full, "utf-8")));
      if (!parsed.success) errors.push(...zodErrors(rel, parsed.error.issues));
      else sources[rel] = "real";
    } catch {
      errors.push(`${rel}: real file is corrupt`);
      sources[rel] = "corrupt";
    }
  }

  return { errors, warnings, knownDrift, sources };
}
