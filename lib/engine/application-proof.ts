import { readFileSync } from "node:fs";
import path from "node:path";
import { chicagoToday } from "../ledger.ts";
import { parseCsv } from "../csv.ts";
import { readReceipt } from "./receipt.ts";
import { safeId } from "./activity-lifecycle.ts";
// An apply activity is complete only after the same job is durably accounted.
export function hasApplicationProof(base: string, jobId: string, refs: string[]): boolean {
  try {
    const read = (name: string) => JSON.parse(readFileSync(path.join(base, "data", name), "utf8"));
    const job = read("jobs.json").jobs.find((j: { id: string }) => j.id === jobId);
    if (job?.status !== "applied") return false;
    const apps = read("applications.json").applications;
    const rows = parseCsv(readFileSync(path.join(base, "data/mirror/ledger.csv"), "utf8"));
    return refs.some((ref) => {
      if (!safeId(ref)) return false;
      const receipt = readReceipt(base, ref);
      if (receipt?.taskId !== ref || receipt.event !== "APPLICATION_SUBMITTED" || !["committed", "verified"].includes(receipt.status)) return false;
      const ops = receipt.ops as { applicationId?: string; ledgerId?: string | number; jobId?: string } | undefined;
      if (!ops?.applicationId || ops.ledgerId === undefined || (ops.jobId && ops.jobId !== jobId)) return false;
      const app = apps.find((a: { id: string }) => a.id === ops.applicationId);
      if (app?.jobId !== jobId || !app.employerConfirmed || !app.appliedAt || app.ledgerRowId !== String(ops.ledgerId)) return false;
      const appDay = /^\d{4}-\d{2}-\d{2}$/.test(app.appliedAt) ? app.appliedAt : chicagoToday(new Date(app.appliedAt));
      return rows.slice(1).some((row) => row[0] === app.ledgerRowId && row[10] === "confirmed" &&
        row[1] === appDay && row[2] === job.company && row[3] === job.role && row[8] === app.resumeVersion);
    });
  } catch { return false; }
}
