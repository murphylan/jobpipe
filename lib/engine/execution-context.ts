import { preflightApplicationSubmitted } from "./preflight.ts";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { readKnowledge } from "../knowledge.ts";
import { readTaskState } from "./task-state.ts";
import { quirksFileSchema } from "./schema.ts";
import { STAGE_IDS } from "../activity-display.ts";

/** Derived, read-only Engine projection. No credentials or arbitrary profile fields. */
export function buildExecutionContext(base: string, stage: string, task: string, jobId?: string) {
  if (!STAGE_IDS.includes(stage) || !task.trim()) throw new Error("stage and task required");
  const rules = ["AGENTS.md", "docs/skill/inbox-contract.md"].map(file => ({ file, body: readFileSync(path.join(base, file), "utf8") }));
  const knowledge = readKnowledge(base);
  const active = knowledge.entries.filter(e => !e.archived);
  // Explicit opt-in prevents legacy free-text personal/credential notes being exported wholesale.
  const selected = active.filter(e => e.tags.includes("agent-context") && !e.tags.some(t => /secret|credential|password/i.test(t)));
  const sensitive = /password|passwd|api[_ -]?key|access[_ -]?token|密码|口令|私钥/i;
  const safe = (text: string) => sensitive.test(text) ? "[敏感内容已省略；请通过凭证管理器获取]" : text;
  const qfile = path.join(base, "data/quirks.json");
  const quirks = existsSync(qfile) ? quirksFileSchema.parse(JSON.parse(readFileSync(qfile, "utf8"))) : { version: 0, quirks: [] };
  const state = readTaskState(base);
  if (state.issues.length) throw new Error(`context data invalid: ${state.issues.join("; ")}`);
  const job = jobId ? state.tasks.find(t => t.jobId === jobId) : undefined;
  if (jobId && !job) throw new Error("context job not found");
  const content = {
    schemaVersion: 1, workspace: path.resolve(base), stage, task,
    rules, knowledgeAvailable: existsSync(path.join(base, "data/knowledge.json")), knowledgeVersion: knowledge.version,
    knowledge: selected.map(e => ({ id: e.id, updatedAt: e.updatedAt, title: safe(e.title), body: safe(e.body) })),
    omittedKnowledgeCount: active.length - selected.length,
    quirksVersion: quirks.version, quirks: quirks.quirks.map(q => ({ id: q.id, trigger: safe(q.trigger), action: safe(q.action) })),
    ...(job ? { job: { jobId: job.jobId, businessStage: job.businessStage, resumeVersion: job.resumeVersion, waitingId: job.runtime.waitingId, activityId: job.runtime.activityId } } : {}),
    ...(stage === "apply" && jobId ? { preflight: preflightApplicationSubmitted(base, jobId) } : {}),
    requirements: ["Read the rules and context before work; report context digest in your first response.", "User approval is mandatory before applying. A context snapshot is not authorization; use Engine preflight immediately before submission.", "Publish semantic stage/progress/waiting events. Tool hooks prove execution only, never business success.", "Account method and vault references must be recorded as non-secret agent-context knowledge. Never put secret values in knowledge, prompts, hooks or Activity.", "Read committed Receipts and unfinished waiting items before retrying. Inbox submission alone is not completion."],
  };
  const digest = createHash("sha256").update(JSON.stringify(content)).digest("hex");
  return { ...content, digest };
}
