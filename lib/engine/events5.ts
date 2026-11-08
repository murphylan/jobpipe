import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { validateContextReference } from "./agent-context.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage B event (execution protocol, 2026-11-08): PLAN_RECORDED.
// The executor records a per-job form plan before any filling
// starts. Every key answer must cite a source; the Engine
// resolves each source against the data it owns (profile fields,
// active Knowledge entries, quirks, registered resume versions,
// answered waiting items). Approval is computed, never asserted:
// a plan is stored as "approved" only when every key source
// resolved AND the payload carries an approval basis (the user's
// application authorization, e.g. a batch approval). Otherwise
// it is stored as "recorded" with its blockers listed, and a
// later higher planVersion supersedes it; superseded versions
// stay in data/plans.json so plan changes keep their history.
// A key answer whose source cannot be resolved can therefore
// never sit inside an approved plan. Secret values never enter
// a plan: secret fields use valueKind "secret-action" and carry
// no plannedValue, only the action marker.
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { isSafeId } from "./events4.ts";
import { planFileSchema, profileFileSchema, quirksFileSchema, resumeVersionsFileSchema, waitingFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";
import { validTime } from "./activity-lifecycle.ts";
import { readKnowledge } from "../knowledge.ts";

export const PLAN_SOURCE_KINDS = ["profile", "knowledge", "quirk", "material", "user-answer"] as const;
export const PLAN_VALUE_KINDS = ["enum", "text", "file", "secret-action", "absent"] as const;

/** Field keys that must be marked key when they appear (backstop for the closed key-answer list). */
const FORCED_KEY_TOKENS = ["full_name", "first_name", "last_name", "legal_name", "email", "phone", "work_auth", "sponsorship", "salary", "education", "attestation"] as const;

type PlanFile = { plans: Record<string, unknown>[]; version: number; updatedAt: string };
type PlanField = {
  fieldKey: string;
  pageLabel: string;
  plannedValue?: unknown;
  valueKind: string;
  source: { kind: string; ref: string } | null;
  key: boolean;
  requiresConfirmation?: boolean;
  verify?: unknown;
};

function readPlanFile(baseDir: string): PlanFile {
  const full = path.join(baseDir, "data", "plans.json");
  if (!existsSync(full)) return { plans: [], version: 0, updatedAt: "" };
  const parsed = planFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) throw new Error("plans.json: invalid");
  return parsed.data as PlanFile;
}

function writeChangelogEntry(baseDir: string, stamp: string, action: string, target: string, version: number, note: string): void {
  const changelogPath = path.join(baseDir, "data", "changelog.json");
  const parsed = existsSync(changelogPath)
    ? (readJsonFile(changelogPath) as { entries: Record<string, unknown>[]; version: number })
    : { entries: [], version: 0 };
  parsed.entries.push({ at: stamp, action, target, version, note });
  writeFileSync(changelogPath, canonicalJson({ ...parsed, version: parsed.version + 1, updatedAt: stamp }), "utf-8");
}

function profileFieldValue(baseDir: string, ref: string): unknown {
  if (!ref.startsWith("profile.")) return undefined;
  const full = path.join(baseDir, "data", "profile.json");
  if (!existsSync(full)) return undefined;
  const parsed = profileFileSchema.safeParse(readJsonFile(full));
  if (!parsed.success) return undefined;
  let cur: unknown = parsed.data;
  for (const part of ref.slice("profile.".length).split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function isNonEmptyValue(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  if (v && typeof v === "object") return Object.values(v as Record<string, unknown>).some(isNonEmptyValue);
  return false;
}

/** Resolve one field source against Engine-owned data. Returns null when resolved, else the blocker reason. */
function sourceBlocker(baseDir: string, jobId: string, field: PlanField): string | null {
  const source = field.source;
  if (!source) return "missing source";
  try {
    if (source.kind === "profile") {
      return isNonEmptyValue(profileFieldValue(baseDir, source.ref)) ? null : `profile field ${source.ref} is empty or missing`;
    }
    if (source.kind === "knowledge") {
      const entry = readKnowledge(baseDir).entries.find((e) => e.id === source.ref);
      return entry && !entry.archived ? null : `knowledge entry ${source.ref} not found or archived`;
    }
    if (source.kind === "quirk") {
      const full = path.join(baseDir, "data", "quirks.json");
      if (!existsSync(full)) return `quirk ${source.ref} not found`;
      const parsed = quirksFileSchema.safeParse(readJsonFile(full));
      return parsed.success && parsed.data.quirks.some((q) => q.id === source.ref) ? null : `quirk ${source.ref} not found`;
    }
    if (source.kind === "material") {
      const full = path.join(baseDir, "data", "resume-versions.json");
      if (!existsSync(full)) return `resume version ${source.ref} not registered`;
      const parsed = resumeVersionsFileSchema.safeParse(readJsonFile(full));
      return parsed.success && parsed.data.versions.some((v) => v.version === source.ref && v.jobId === jobId)
        ? null
        : `resume version ${source.ref} not registered for job ${jobId}`;
    }
    if (source.kind === "user-answer") {
      const full = path.join(baseDir, "data", "waiting.json");
      if (!existsSync(full)) return `waiting answer ${source.ref} not found`;
      const parsed = waitingFileSchema.safeParse(readJsonFile(full));
      if (!parsed.success) return `waiting answer ${source.ref} not found`;
      const item = parsed.data.items.find((i) => i.waitingId === source.ref);
      if (!item || item.status !== "answered") return `waiting answer ${source.ref} is not an answered item`;
      const itemJob = (item as Record<string, unknown>).jobId;
      return itemJob === undefined || itemJob === jobId ? null : `waiting answer ${source.ref} belongs to another job`;
    }
  } catch {
    return `source ${source.kind}:${source.ref} could not be read`;
  }
  return `unknown source kind ${source.kind}`;
}

export function planHashOf(plan: {
  planId: string; jobId: string; runId: string; planVersion: number; resumeVersion: string; formUrl: string; fields: PlanField[];
}): string {
  const input = JSON.stringify({
    planId: plan.planId,
    jobId: plan.jobId,
    runId: plan.runId,
    planVersion: plan.planVersion,
    resumeVersion: plan.resumeVersion,
    formUrl: plan.formUrl,
    fields: plan.fields.map((f) => [f.fieldKey, f.pageLabel, f.plannedValue ?? null, f.valueKind, f.key, f.source ? [f.source.kind, f.source.ref] : null]),
  });
  return createHash("sha256").update(input).digest("hex");
}

export function applyPlanRecorded(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  try { validateContextReference(baseDir, cs.payload); } catch (error) { return { ok: false, errors: [error instanceof Error ? error.message : String(error)] }; }
  if (!validTime(stamp) || !isSafeId(cs.taskId))
    return { ok: false, errors: ["E_SCHEMA: valid createdAt and safe taskId required"] };
  if (!cs.payload || typeof cs.payload !== "object" || Array.isArray(cs.payload))
    return { ok: false, errors: ["E_SCHEMA: payload must be an object"] };
  const p = cs.payload as Record<string, unknown>;
  const planId = p.planId;
  if (!isSafeId(planId)) return { ok: false, errors: ["E_SCHEMA: payload.planId missing or unsafe"] };
  const jobId = p.jobId;
  if (!isSafeId(jobId)) return { ok: false, errors: ["E_SCHEMA: payload.jobId missing or unsafe"] };
  const runId = p.runId;
  if (!isSafeId(runId)) return { ok: false, errors: ["E_SCHEMA: payload.runId missing or unsafe"] };
  const activityId = p.activityId;
  if (activityId !== undefined && !isSafeId(activityId))
    return { ok: false, errors: ["E_SCHEMA: payload.activityId must be safe"] };
  const planVersion = p.planVersion;
  if (!Number.isSafeInteger(planVersion) || Number(planVersion) < 1)
    return { ok: false, errors: ["E_SCHEMA: payload.planVersion must be a positive integer"] };
  const resumeVersion = p.resumeVersion;
  if (typeof resumeVersion !== "string" || resumeVersion === "")
    return { ok: false, errors: ["E_SCHEMA: payload.resumeVersion missing"] };
  const formUrl = p.formUrl;
  if (typeof formUrl !== "string" || formUrl === "")
    return { ok: false, errors: ["E_SCHEMA: payload.formUrl missing"] };
  if (!Array.isArray(p.fields) || p.fields.length === 0)
    return { ok: false, errors: ["E_SCHEMA: payload.fields must be a non-empty array"] };
  const fields: PlanField[] = [];
  for (const raw of p.fields as unknown[]) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return { ok: false, errors: ["E_SCHEMA: each field must be an object"] };
    const f = raw as Record<string, unknown>;
    if (typeof f.fieldKey !== "string" || f.fieldKey === "")
      return { ok: false, errors: ["E_SCHEMA: field.fieldKey missing"] };
    if (typeof f.pageLabel !== "string")
      return { ok: false, errors: [`E_SCHEMA: field ${f.fieldKey} pageLabel missing`] };
    if (typeof f.valueKind !== "string" || !(PLAN_VALUE_KINDS as readonly string[]).includes(f.valueKind))
      return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} valueKind must be one of ${PLAN_VALUE_KINDS.join(", ")}`] };
    if (typeof f.key !== "boolean")
      return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} key must be boolean`] };
    if (f.key !== true && FORCED_KEY_TOKENS.some((t) => String(f.fieldKey).toLowerCase().includes(t)))
      return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} is a key answer and must be marked key`] };
    if (f.valueKind === "secret-action" && f.plannedValue !== undefined && f.plannedValue !== null)
      return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} is secret-action and must not carry a plannedValue`] };
    let source: PlanField["source"] = null;
    if (f.source !== undefined && f.source !== null) {
      if (typeof f.source !== "object" || Array.isArray(f.source))
        return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} source must be an object`] };
      const s = f.source as Record<string, unknown>;
      if (typeof s.kind !== "string" || !(PLAN_SOURCE_KINDS as readonly string[]).includes(s.kind) || typeof s.ref !== "string" || s.ref === "")
        return { ok: false, errors: [`E_SCHEMA: field ${String(f.fieldKey)} source kind/ref invalid`] };
      source = { kind: s.kind, ref: s.ref };
    }
    if (f.key === true && !source)
      return { ok: false, errors: [`E_SCHEMA: key field ${String(f.fieldKey)} must cite a source`] };
    fields.push({
      fieldKey: f.fieldKey,
      pageLabel: f.pageLabel,
      ...(f.plannedValue !== undefined ? { plannedValue: f.plannedValue } : {}),
      valueKind: f.valueKind,
      source,
      key: f.key,
      ...(typeof f.requiresConfirmation === "boolean" ? { requiresConfirmation: f.requiresConfirmation } : {}),
      ...(f.verify !== undefined ? { verify: f.verify } : {}),
    });
  }
  if (new Set(fields.map((f) => f.fieldKey)).size !== fields.length)
    return { ok: false, errors: ["E_SCHEMA: duplicate fieldKey in plan"] };
  let approvalBasis: { kind: string; ref: string } | null = null;
  if (p.approvalBasis !== undefined && p.approvalBasis !== null) {
    if (typeof p.approvalBasis !== "object" || Array.isArray(p.approvalBasis))
      return { ok: false, errors: ["E_SCHEMA: payload.approvalBasis must be an object"] };
    const ab = p.approvalBasis as Record<string, unknown>;
    if ((ab.kind !== "batch-authorization" && ab.kind !== "single-approval") || typeof ab.ref !== "string" || ab.ref === "")
      return { ok: false, errors: ["E_SCHEMA: approvalBasis kind/ref invalid"] };
    approvalBasis = { kind: ab.kind, ref: ab.ref };
  }
  // Resume version must be registered for this job (material guard).
  const resumeBlocker = sourceBlocker(baseDir, jobId, { fieldKey: "resume", pageLabel: "", valueKind: "file", source: { kind: "material", ref: resumeVersion }, key: true });
  if (resumeBlocker) return { ok: false, errors: [`E_SOURCE_UNRESOLVED: ${resumeBlocker}`] };
  const blockers: string[] = [];
  for (const f of fields) {
    if (!f.key) continue;
    const blocker = sourceBlocker(baseDir, jobId, f);
    if (blocker) blockers.push(`${f.fieldKey}: ${blocker}`);
  }
  if (!approvalBasis) blockers.push("approval-basis: missing");
  const status = blockers.length === 0 ? "approved" : "recorded";
  const planHash = planHashOf({ planId, jobId, runId, planVersion: Number(planVersion), resumeVersion, formUrl, fields });
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["plans.json", "changelog.json"], () => {
    const jobs = readJsonFile(path.join(baseDir, "data/jobs.json")) as { jobs: { id: string; status?: string }[] };
    const job = jobs.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error(`E_REF_INVALID: plan job ${jobId} not found`);
    if (job.status === "applied") throw new Error(`E_GUARD:already-applied: job ${jobId} is already applied`);
    if (job.status === "dropped") throw new Error(`E_GUARD:job-dropped: job ${jobId} is dropped`);
    const appsPath = path.join(baseDir, "data", "applications.json");
    if (existsSync(appsPath)) {
      const apps = readJsonFile(appsPath) as { applications: { jobId: string }[] };
      if (apps.applications.some((a) => a.jobId === jobId))
        throw new Error(`E_GUARD:already-applied: job ${jobId} already has an application record`);
    }
    const data = readPlanFile(baseDir);
    if (data.plans.some((pl) => pl.planId === planId))
      throw new Error(`E_DUPLICATE: plan ${planId} already exists`);
    const siblings = data.plans.filter((pl) => pl.jobId === jobId && pl.runId === runId && pl.status !== "superseded");
    if (siblings.some((pl) => Number(pl.planVersion) >= Number(planVersion)))
      throw new Error(`E_DUPLICATE: plan version ${String(planVersion)} does not advance job ${jobId} run ${runId}`);
    for (const sib of siblings) sib.status = "superseded";
    data.plans.push({
      planId,
      jobId,
      runId,
      activityId: typeof activityId === "string" ? activityId : null,
      planVersion: Number(planVersion),
      resumeVersion,
      formUrl,
      fields,
      approvalBasis,
      status,
      blockers,
      planHash,
      taskId: cs.taskId,
      createdAt: stamp,
    });
    const version = data.version + 1;
    writeFileSync(path.join(baseDir, "data", "plans.json"), canonicalJson({ ...data, version, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "plan-recorded", "plans.json", version, `${cs.taskId} ${planId} v${String(planVersion)} ${status} hash ${planHash.slice(0, 12)}`);
    summary = `PLAN_RECORDED ${planId} v${String(planVersion)} ${status} hash ${planHash}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
