// FR-32: Diff Preview (P0). Every write operation must generate a diff
// preview BEFORE touching disk. The user reviews the preview and
// approves; only then does the engine apply. Preview records are
// stored in the receipt (data/receipts/<taskId>.json) and queryable
// via the console API.
//
// Design: the Expansion object from expand.ts already contains all
// planned changes. buildDiffPreview() converts it into a human-
// readable, file-by-file diff. The daemon writes the preview into
// the receipt's `ops.diffPreview` field with status pending-approval.
//
// Integration (daemon.ts): when creating a pending-approval receipt
// for an expansion, call:
//   const preview = buildDiffPreview(taskId, event, expansion, registryWrites);
//   writeReceipt(baseDir, { ..., status: "pending-approval",
//     ops: { diffPreview: preview } });
// The console UI renders preview.files[] so the user sees exactly
// what will change before approving.
import type { Expansion } from "./expand.ts";

export type FileChange = {
  path: string;
  operation: "modify-record" | "add-record" | "append-row" | "add-entry" | "increment-counter";
  /** Human-readable one-line summary. */
  summary: string;
  /** Machine-readable details for the UI. */
  details: Record<string, unknown>;
};

export type DiffPreview = {
  taskId: string;
  event: string;
  createdAt: string;
  /** True if the preview covers all files the registry says the event writes. */
  complete: boolean;
  files: FileChange[];
  /** Files from the registry that have no preview entry (gap warning). */
  missingFiles: string[];
};

/**
 * Build a diff preview from an Expansion.
 * @param taskId - the ChangeSet task id
 * @param event - the event name (e.g. APPLICATION_SUBMITTED)
 * @param expansion - the dry-run expansion from expand.ts
 * @param registryWrites - the `writes` list from registry.yaml for this event
 */
export function buildDiffPreview(
  taskId: string,
  event: string,
  expansion: Expansion,
  registryWrites: string[],
): DiffPreview {
  const files: FileChange[] = [];
  const covered = new Set<string>();

  if (event === "APPLICATION_SUBMITTED") {
    const job = expansion.job as { id?: string; company?: string; role?: string; status?: string };
    // jobs.json: status flip approved -> applied
    files.push({
      path: "data/jobs.json",
      operation: "modify-record",
      summary: `Job ${job.id ?? "?"} (${job.company ?? "?"} / ${job.role ?? "?"}): status approved → applied`,
      details: {
        recordId: job.id,
        field: "status",
        before: "approved",
        after: "applied",
        fileVersion: expansion.jobsFileVersion,
      },
    });
    covered.add("data/jobs.json");

    // applications.json: new record
    const app = expansion.application as { id?: string; jobId?: string };
    files.push({
      path: "data/applications.json",
      operation: "add-record",
      summary: `New application ${app.id ?? "?"} for job ${app.jobId ?? "?"} (stage: applied)`,
      details: {
        recordId: app.id,
        record: app,
        fileVersion: expansion.applicationsFileVersion,
      },
    });
    covered.add("data/applications.json");

    // ledger.csv: new row
    files.push({
      path: "data/mirror/ledger.csv",
      operation: "append-row",
      summary: `Ledger new row id=${expansion.ledgerId} (${job.company ?? "?"} / ${job.role ?? "?"}, confirmed)`,
      details: {
        rowId: expansion.ledgerId,
        row: expansion.ledgerRow,
      },
    });
    covered.add("data/mirror/ledger.csv");

    // changelog.json: new entry
    const ce = expansion.changelogEntry as { action?: string; note?: string };
    files.push({
      path: "data/changelog.json",
      operation: "add-entry",
      summary: `Changelog entry: ${ce.action ?? "?"} — ${ce.note ?? ""}`,
      details: { entry: expansion.changelogEntry },
    });
    covered.add("data/changelog.json");

    // daily.json: counter preview
    files.push({
      path: "data/daily.json",
      operation: "increment-counter",
      summary: `Daily ${expansion.today}: apply count → ${expansion.dailyApplyPreview} (preview, recomputed on apply)`,
      details: {
        date: expansion.today,
        previewCount: expansion.dailyApplyPreview,
      },
    });
    covered.add("data/daily.json");
  }

  const missingFiles = registryWrites.filter((w) => !covered.has(w));
  return {
    taskId,
    event,
    createdAt: new Date().toISOString(),
    complete: missingFiles.length === 0,
    files,
    missingFiles,
  };
}

/** Render a diff preview as human-readable markdown (for receipt .md files). */
export function renderDiffPreviewMd(preview: DiffPreview): string {
  const lines = [
    `## Diff Preview (FR-32)`,
    ``,
    `- task: ${preview.taskId}`,
    `- event: ${preview.event}`,
    `- createdAt: ${preview.createdAt}`,
    `- complete: ${preview.complete ? "yes" : "NO -- missing: " + preview.missingFiles.join(", ")}`,
    ``,
  ];
  for (const f of preview.files) {
    lines.push(`### ${f.path} (${f.operation})`);
    lines.push(`- ${f.summary}`);
    lines.push(``);
  }
  return lines.join("\n");
}
