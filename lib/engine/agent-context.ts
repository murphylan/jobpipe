import path from "node:path";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { buildExecutionContext } from "./execution-context.ts";
import { commitFiles, type GenericChangeSet, type EventResult } from "./events.ts";
import { atomicWriteFileSync } from "./storage.ts";
import { isSafeTaskId, eventHash } from "./envelope.ts";
import { readReceipt } from "./receipt.ts";
import { readKnowledge } from "../knowledge.ts";

export function applyAgentContextRequested(base: string, cs: GenericChangeSet): EventResult {
  const p = cs.payload;
  if (!isSafeTaskId(p.sessionId) || typeof p.stage !== "string" || (p.stage === "apply" && !p.jobId) || typeof p.task !== "string" || !p.task.trim() || p.task.length > 8000 || (p.jobId !== undefined && !isSafeTaskId(p.jobId))) return { ok: false, errors: ["E_SCHEMA: sessionId, stage and task required"] };
  try {
    const { digest, ...context } = buildExecutionContext(base, p.stage, p.task, p.jobId as string | undefined);
    const file = `agent-contexts/${cs.taskId}.json`;
    const result = commitFiles(base, cs.taskId, [file], () => atomicWriteFileSync(path.join(base, "data", file), JSON.stringify({ requestTaskId: cs.taskId, sessionId: p.sessionId, createdAt: cs.createdAt, inputHash: eventHash(cs), content: JSON.stringify(context), digest }, null, 2)));
    return result.ok ? { ok: true, summary: `AGENT_CONTEXT_REQUESTED data/${file}; digest ${digest}` } : result;
  } catch (error) { return { ok: false, errors: [`E_CONTEXT: ${error instanceof Error ? error.message : String(error)}`] }; }
}

/** Optional for legacy senders; the Hatch entry requires it for every signal. */
export function validateContextReference(base: string, payload: Record<string, unknown>) {
  if (payload.contextTaskId === undefined && payload.contextDigest === undefined) return;
  if (!isSafeTaskId(payload.contextTaskId) || typeof payload.contextDigest !== "string") throw new Error("E_CONTEXT: invalid context reference");
  const snapshot = JSON.parse(readFileSync(path.join(base, "data/agent-contexts", `${payload.contextTaskId}.json`), "utf8"));
  const receipt = readReceipt(base, payload.contextTaskId);
  if (!receipt || !["committed", "verified"].includes(receipt.status) || receipt.event !== "AGENT_CONTEXT_REQUESTED" || receipt.inputHash !== snapshot.inputHash) throw new Error("E_CONTEXT: context request not committed");
  if (snapshot.requestTaskId !== payload.contextTaskId || snapshot.sessionId !== payload.runId || snapshot.digest !== payload.contextDigest || createHash("sha256").update(snapshot.content).digest("hex") !== snapshot.digest) throw new Error("E_CONTEXT: digest or run mismatch");
  const context = JSON.parse(snapshot.content);
  if (context.workspace !== path.resolve(base) || context.stage !== payload.stage || context.job?.jobId !== payload.jobId) throw new Error("E_CONTEXT: workspace/stage/job mismatch");
  const quirksFile = path.join(base, "data/quirks.json");
  if (context.quirksVersion !== (existsSync(quirksFile) ? JSON.parse(readFileSync(quirksFile, "utf8")).version : 0)) throw new Error("E_CONTEXT: quirks changed; request fresh context");
  if (context.knowledgeVersion !== readKnowledge(base).version || context.rules.some((rule: { file: string; body: string }) => readFileSync(path.join(base, rule.file), "utf8") !== rule.body)) throw new Error("E_CONTEXT: rules or Knowledge changed; request fresh context");

  if (payload.status === "done") {
    const events: Record<string, string[]> = { discovery: ["DISCOVERED"], screening: ["SCREENED"], tailoring: ["TAILORED"], review: ["USER_DECIDED"], apply: ["APPLICATION_SUBMITTED"], ledger: ["APPLICATION_SUBMITTED", "FOLLOWUP_RECEIVED"] };
    if (!Array.isArray(payload.refs) || !payload.refs.length) throw new Error("E_CONTEXT: business Receipt refs required for completion");
    for (const ref of payload.refs) {
      if (!isSafeTaskId(ref)) throw new Error("E_CONTEXT: invalid business Receipt reference");
      const business = readReceipt(base, ref);
      if (!business || !["committed", "verified"].includes(business.status) || !events[context.stage]?.includes(business.event)) throw new Error("E_CONTEXT: business Receipt missing or wrong stage");
      const source = JSON.parse(readFileSync(path.join(base, "data/processed", `${ref}.json`), "utf8"));
      if (business.inputHash !== eventHash(source)) throw new Error("E_CONTEXT: business Receipt identity mismatch");
      if (payload.jobId !== undefined) {
        let jobId = source.payload.jobId ?? source.payload.job?.id;
        if (business.event === "FOLLOWUP_RECEIVED") {
          const apps = JSON.parse(readFileSync(path.join(base, "data/applications.json"), "utf8"));
          jobId = apps.applications.find((a: { ledgerRowId?: string }) => a.ledgerRowId === String(source.payload.ledgerRowId))?.jobId;
        }
        if (jobId !== payload.jobId) throw new Error("E_CONTEXT: business Receipt belongs to another job");
      }
    }
  }
}
