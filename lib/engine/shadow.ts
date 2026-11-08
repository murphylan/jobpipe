import { assertSafeTaskId } from "./envelope.ts";
// Stage 3 shadow mode, first cut (Doc-00 section 10, mode B).
// In shadow mode Muse still writes directly, and also submits
// the ChangeSet. The engine then compares, from a pre-write
// snapshot Muse kept, what its own dry-run expansion says
// against what is actually on disk now. This function takes
// a snapshot directory (the data/ tree as it was before the
// direct write) and the current directory, and returns the
// differences, if any. An empty differences list means the
// direct write and the engine expansion agree exactly.
// It writes nothing itself; the CLI writes the report to
// data/runs/shadow-<taskId>.json in the current directory.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";
import { expandApplicationSubmitted, type ChangeSetInput } from "./expand.ts";

export type ShadowReport = {
  taskId: string;
  event: string;
  comparedAt: string;
  differences: string[];
  expansion: unknown;
};

export function shadowCompare(snapshotBaseDir: string, currentBaseDir: string, changeset: ChangeSetInput): ShadowReport {
  const differences: string[] = [];
  const expanded = expandApplicationSubmitted(snapshotBaseDir, changeset, {});
  if (!expanded.ok) {
    return { taskId: changeset.taskId, event: changeset.event, comparedAt: new Date().toISOString(), differences: [`expansion failed on snapshot: ${expanded.errors.join("; ")}`], expansion: null };
  }
  const exp = expanded.expansion;
  const currentData = path.join(currentBaseDir, "data");
  try {
    const jobs = JSON.parse(readFileSync(path.join(currentData, "jobs.json"), "utf-8")) as { jobs: { id?: unknown; status?: unknown }[] };
    const job = jobs.jobs.find((j) => j.id === exp.job.id);
    if (!job) differences.push(`job ${String(exp.job.id)} missing after direct write`);
    else if (job.status !== "applied") differences.push(`job status is ${String(job.status)}, expected applied`);
  } catch {
    differences.push("jobs.json unreadable after direct write");
  }
  try {
    const apps = JSON.parse(readFileSync(path.join(currentData, "applications.json"), "utf-8")) as { applications: { id?: unknown }[] };
    if (!apps.applications.some((a) => a.id === exp.application.id))
      differences.push(`application ${String(exp.application.id)} missing after direct write`);
  } catch {
    differences.push("applications.json unreadable after direct write");
  }
  try {
    const rows = parseCsv(readFileSync(path.join(currentData, "mirror", "ledger.csv"), "utf-8"));
    const row = rows.find((r) => r[0] === String(exp.ledgerId));
    if (!row) differences.push(`ledger row ${exp.ledgerId} missing after direct write`);
    else if (row.join(",") !== exp.ledgerRow.join(",")) differences.push(`ledger row ${exp.ledgerId} differs from expansion`);
  } catch {
    differences.push("ledger.csv unreadable after direct write");
  }
  try {
    const daily = JSON.parse(readFileSync(path.join(currentData, "daily.json"), "utf-8")) as { days?: Record<string, { apply?: number }> };
    // 对账用的日期必须是展开用的同一天（exp.today），不能用 createdAt 日期。
    const today = exp.today;
    const apply = daily.days?.[today]?.apply;
    if (apply !== exp.dailyApplyPreview) differences.push(`daily ${today} apply is ${String(apply)}, expected ${exp.dailyApplyPreview}`);
  } catch {
    differences.push("daily.json unreadable after direct write");
  }
  return { taskId: changeset.taskId, event: changeset.event, comparedAt: new Date().toISOString(), differences, expansion: exp };
}

export function shadowReportPath(currentBaseDir: string, taskId: string): string {
  assertSafeTaskId(taskId);
  return path.join(currentBaseDir, "data", "runs", `shadow-${taskId}.json`);
}
export function snapshotExists(snapshotBaseDir: string): boolean {
  return existsSync(path.join(snapshotBaseDir, "data", "jobs.json"));
}
