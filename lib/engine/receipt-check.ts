import { assertSafeTaskId } from "./envelope.ts";
// Check receipt status for a taskId (2026-11-05).
// Used by Muse after sending inbox events: if rejected, read errors and fix.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ReceiptStatus = {
  found: boolean;
  taskId: string;
  status?: "committed" | "rejected" | "pending";
  summary?: string;
  errors?: string[];
  event?: string;
};

export function checkReceipt(baseDir: string, taskId: string): ReceiptStatus {
  assertSafeTaskId(taskId);
  const receiptPath = path.join(baseDir, "data", "receipts", `${taskId}.json`);
  if (!existsSync(receiptPath)) {
    // Check if still in inbox (pending)
    const inboxPath = path.join(baseDir, "data", "inbox", `${taskId}.json`);
    if (existsSync(inboxPath)) {
      return { found: true, taskId, status: "pending", summary: "still in inbox, not processed yet" };
    }
    return { found: false, taskId };
  }
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, "utf-8"));
    return {
      found: true,
      taskId,
      status: receipt.status,
      summary: receipt.summary,
      errors: receipt.errors,
      event: receipt.event,
    };
  } catch {
    return { found: false, taskId };
  }
}
