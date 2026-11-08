import { assertSafeTaskId } from "./envelope.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 2 receipts (Doc-00 sections 6.3 and 9).
// Every ChangeSet the engine touches gets a receipt in
// data/receipts/<taskId>.json (machine) and .md (human). A
// receipt is the only thing Muse may quote as "done": a run
// without a committed/verified receipt is not done, even if
// files on disk look changed.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./serialize.ts";

export type ReceiptStatus = "committed" | "verified" | "rejected" | "failed" | "pending-approval";
export type Receipt = {
  taskId: string;
  event: string;
  status: ReceiptStatus;
  createdAt: string;
  summary: string;
  errors?: string[];
  ops?: unknown;
  inputHash?: string;
};

function receiptsDir(baseDir: string): string {
  return path.join(baseDir, "data", "receipts");
}

export function writeReceipt(baseDir: string, receipt: Receipt): { jsonPath: string; mdPath: string } {
  assertSafeTaskId(receipt.taskId);
  const prior = readReceipt(baseDir, receipt.taskId);
  if (prior && prior.status !== "pending-approval" && (receipt.status !== prior.status || receipt.event !== prior.event || receipt.summary !== prior.summary || receipt.createdAt !== prior.createdAt)) throw new Error("E_RECEIPT_IMMUTABLE: cannot replace committed receipt");
  const identity = identities.get(path.resolve(baseDir) + ":" + receipt.taskId) ?? prior?.inputHash;
  if (identity) receipt = { ...receipt, inputHash: identity };
  const dir = receiptsDir(baseDir);
  mkdirSync(dir, { recursive: true });
  const jsonPath = path.join(dir, `${receipt.taskId}.json`);
  const mdPath = path.join(dir, `${receipt.taskId}.md`);

  const lines = [
    `# Receipt ${receipt.taskId}`,
    ``,
    `- status: ${receipt.status}`,
    `- event: ${receipt.event}`,
    `- createdAt: ${receipt.createdAt}`,
    `- summary: ${receipt.summary}`,
  ];
  if (receipt.errors?.length) {
    lines.push(``, `## Errors`);
    for (const e of receipt.errors) lines.push(`- ${e}`);
  }
  writeFileSync(mdPath, lines.join("\n") + "\n", "utf-8");
  if (["committed", "verified"].includes(receipt.status)) {
    const run = path.join(baseDir, "data", "runs", `${receipt.taskId}.json`);
    if (!prior || !["committed", "verified"].includes(prior.status)) writeFileSync(run, canonicalJson({ taskId: receipt.taskId, event: receipt.event, status: "committed", summary: receipt.summary, finishedAt: receipt.createdAt }));
  }
  writeFileSync(jsonPath, canonicalJson(receipt), "utf-8");
  identities.delete(path.resolve(baseDir) + ":" + receipt.taskId);
  return { jsonPath, mdPath };
}

export function readReceipt(baseDir: string, taskId: string): Receipt | null {
  assertSafeTaskId(taskId);
  const full = path.join(receiptsDir(baseDir), `${taskId}.json`);
  if (!existsSync(full)) return null;
  try {
    const receipt = JSON.parse(readFileSync(full, "utf-8")) as Receipt;
    if (!receipt || receipt.taskId !== taskId || typeof receipt.event !== "string" || typeof receipt.summary !== "string" || !["committed", "verified", "rejected", "failed", "pending-approval"].includes(receipt.status)) throw new Error("invalid receipt");
    return receipt;
  } catch {
    throw new Error(`E_RECEIPT_CORRUPT: ${taskId}`);
  }
}

const identities = new Map<string, string>();
export function setReceiptIdentity(baseDir: string, taskId: string, hash: string): void {
  assertSafeTaskId(taskId);
  identities.set(path.resolve(baseDir) + ":" + taskId, hash);
}
