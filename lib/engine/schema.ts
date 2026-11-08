// Stage 1 engine schemas (Doc-00 section 9, first cut).
// These mirror lib/datafiles.ts, lib/jobs.ts and lib/ledger.ts as of
// 2026-11-01. They are validation-only in this cut: nothing in the
// app imports them yet, and no data file is rewritten through them.
// Schemas use loose objects so real files keep fields the old TS
// types omit (Job.jdMissing, ChangelogFile.version/updatedAt,
// ProfileFile.workAuth and similar). Dropping unknown fields here
// would silently lose data on any future round-trip.
import { z } from "zod";
import { COLS } from "../ledger.ts";

export const jobStatusSchema = z.enum(["new", "screening", "approved", "applied", "dropped"]);
export const jobConclusionSchema = z.enum(["apply", "drop", "pending"]);

export const jobSchema = z.looseObject({
  id: z.string().min(1),
  company: z.string(),
  role: z.string(),
  channel: z.string(),
  location: z.string(),
  remote: z.string(),
  salaryPosted: z.string().nullable(),
  salaryAnswer: z.number().nullable(),
  matchPoints: z.array(z.string()),
  redFlags: z.array(z.string()),
  conclusion: jobConclusionSchema,
  status: jobStatusSchema,
  version: z.number().optional(),
  updatedAt: z.string().optional(),
  url: z.string().optional(),
  description: z.string().optional(),
  jdMissing: z.string().optional(),
  jdKind: z.enum(["full", "summary"]).optional(),
  jdSha256: z.string().optional(),
});

export const jobsFileSchema = z
  .looseObject({
    jobs: z.array(jobSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine((data) => new Set(data.jobs.map((j) => j.id)).size === data.jobs.length, {
    message: "jobs.json: duplicate id",
  });

export const appStageSchema = z.enum([
  "todo",
  "applied",
  "replied",
  "screen",
  "interview",
  "offer",
  "rejected",
  "rejected_after_contact",
  "withdrawn",
  "ghosted",
]);

export const applicationSchema = z.looseObject({
  id: z.string().min(1),
  jobId: z.string().min(1),
  ledgerRowId: z.string().nullable(),
  resumeVersion: z.string(),
  source: z.string(),
  collectedAt: z.string(),
  appliedAt: z.string().nullable(),
  employerConfirmed: z.boolean(),
  stage: appStageSchema,
  nextAction: z.string().nullable(),
  nextActionDue: z.string().nullable(),
  interviewAt: z.string().nullable(),
  notes: z.string(),
  version: z.number(),
  updatedAt: z.string(),
});

export const applicationsFileSchema = z
  .looseObject({
    applications: z.array(applicationSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine(
    (data) => new Set(data.applications.map((a) => a.id)).size === data.applications.length,
    { message: "applications.json: duplicate id" },
  );

export const dailyStagesSchema = z.object({
  discovery: z.number(),
  screening: z.number(),
  tailoring: z.number(),
  review: z.number(),
  apply: z.number(),
});

export const dailyFileSchema = z.looseObject({
  days: z.record(z.string(), dailyStagesSchema),
  version: z.number(),
  updatedAt: z.string(),
});

export const dailyTargetsFileSchema = z.looseObject({
  targets: z.record(z.string(), z.number()),
  version: z.number(),
  updatedAt: z.string(),
});

export const changelogEntrySchema = z.looseObject({
  at: z.string(),
  action: z.string(),
  target: z.string(),
  version: z.number(),
  note: z.string(),
});

export const changelogFileSchema = z.looseObject({
  entries: z.array(changelogEntrySchema),
  version: z.number(),
  updatedAt: z.string(),
});

export const resumeVersionSchema = z.looseObject({
  version: z.string(),
  jobId: z.string(),
  file: z.string().nullable(),
  createdAt: z.string(),
  note: z.string(),
  fileExists: z.boolean().optional(),
});

export const resumeVersionsFileSchema = z.looseObject({
  versions: z.array(resumeVersionSchema),
  selected: z.record(z.string(), z.string()),
  version: z.number(),
  updatedAt: z.string(),
});

export const resumeBlockSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(["skill", "project", "summary", "experience", "education"]),
  title: z.string(),
  body: z.string(),
  source: z.string(),
  sourceFile: z.string().optional(),
  sourceSection: z.string().optional(),
  verificationStatus: z.string().optional(),
  version: z.number(),
  updatedAt: z.string(),
});

export const resumesFileSchema = z.looseObject({
  blocks: z.array(resumeBlockSchema),
  version: z.number(),
  updatedAt: z.string(),
});

export const profileFileSchema = z.looseObject({
  version: z.number(),
  updatedAt: z.string(),
  legalFirstName: z.string().optional(),
  legalLastName: z.string().optional(),
  preferredName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  address: z
    .looseObject({
      line1: z.string(),
      city: z.string(),
      state: z.string(),
      zip: z.string(),
      country: z.string(),
    })
    .optional(),
  linkedin: z.string().optional(),
  github: z.string().optional(),
});

export const quirkSchema = z.looseObject({
  id: z.string(),
  trigger: z.string(),
  action: z.string(),
  source: z.string(),
  version: z.number(),
  updatedAt: z.string(),
});

export const quirksFileSchema = z.looseObject({
  quirks: z.array(quirkSchema),
  version: z.number(),
  updatedAt: z.string(),
});

export const skillFileSchema = z.looseObject({
  skillVersion: z.string(),
  changelog: z.array(z.string()),
  dependencies: z.array(z.string()),
  version: z.number(),
  updatedAt: z.string(),
});

// Activity console (Doc-07): append-only feed and waiting
// queue. Activity entries may repeat an activityId (a later
// entry supersedes); waiting ids are unique.
export const activityEntrySchema = z.looseObject({
  scope: z.enum(["job", "batch"]).optional(),
  activityId: z.string().min(1),
  jobId: z.string().optional(),
  kind: z.enum(["screening", "applying", "gmail-check", "recording", "other"]),
  stage: z.enum(["discovery", "screening", "tailoring", "review", "apply", "ledger"]).optional(),
  title: z.string(),
  status: z.enum(["running", "done", "waiting", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  refs: z.array(z.string()),
  note: z.string(),
  evidence: z.array(z.looseObject({ kind: z.string(), text: z.string() })),
  taskId: z.string(),
  createdAt: z.string(),
  runId: z.string().optional(),
  sequence: z.number().int().nonnegative().optional(),
  leaseExpiresAt: z.string().optional(),
  restartOf: z.string().optional(),
});

export const activityFileSchema = z.looseObject({
  activities: z.array(activityEntrySchema),
  version: z.number(),
  updatedAt: z.string(),
});

export const waitingItemSchema = z.looseObject({
  waitingId: z.string().min(1),
  jobId: z.string().optional(),
  question: z.string(),
  context: z.array(z.string()),
  kind: z.enum(["question", "approval", "manual-step"]),
  status: z.enum(["open", "answered", "parked"]),
  createdAt: z.string(),
  sourceActivityId: z.string().nullable(),
  answer: z.string().nullable(),
  answeredAt: z.string().nullable(),
  taskId: z.string(),
});

export const waitingFileSchema = z
  .looseObject({
    items: z.array(waitingItemSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine((data) => new Set(data.items.map((i) => i.waitingId)).size === data.items.length, {
    message: "waiting.json: duplicate waitingId",
  });

// Form plans (execution protocol stage B, 2026-11-08): one record
// per recorded plan version in data/plans.json. Approval is an
// Engine-computed status, never asserted by the sender: a plan is
// "approved" only when every key answer's source resolved at
// record time and an approval basis was carried; otherwise it is
// "recorded" with blockers, and a higher planVersion supersedes
// it (the old record stays, marked "superseded", for audit).
export const planFieldSchema = z.looseObject({
  fieldKey: z.string().min(1),
  pageLabel: z.string(),
  plannedValue: z.unknown().optional(),
  valueKind: z.enum(["enum", "text", "file", "secret-action", "absent"]),
  source: z
    .looseObject({
      kind: z.enum(["profile", "knowledge", "quirk", "material", "user-answer"]),
      ref: z.string().min(1),
    })
    .nullable(),
  key: z.boolean(),
  requiresConfirmation: z.boolean().optional(),
});

export const planRecordSchema = z.looseObject({
  planId: z.string().min(1),
  jobId: z.string().min(1),
  runId: z.string().min(1),
  activityId: z.string().nullable(),
  planVersion: z.number().int().positive(),
  resumeVersion: z.string().min(1),
  formUrl: z.string(),
  fields: z.array(planFieldSchema),
  approvalBasis: z
    .looseObject({ kind: z.enum(["batch-authorization", "single-approval"]), ref: z.string().min(1) })
    .nullable(),
  status: z.enum(["approved", "recorded", "superseded"]),
  blockers: z.array(z.string()),
  planHash: z.string().min(1),
  taskId: z.string(),
  createdAt: z.string(),
});

export const planFileSchema = z
  .looseObject({
    plans: z.array(planRecordSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine((data) => new Set(data.plans.map((p) => p.planId)).size === data.plans.length, {
    message: "plans.json: duplicate planId",
  });

// Read-back checkpoints (execution protocol stage C, 2026-11-08):
// one record per checkpoint in data/checkpoints.json. The sender
// reports the read-back values themselves; the Engine recomputes
// each result against the bound plan and computes the verdict
// (passed/failed) itself, so a claimed "match" is never trusted.
export const checkpointResultSchema = z.looseObject({
  fieldKey: z.string().min(1),
  expected: z.unknown().optional(),
  readback: z.unknown().optional(),
  result: z.enum(["match", "mismatch", "unreadable", "not-applicable"]),
  basis: z.enum(["dom-value", "screenshot", "file-name"]).optional(),
});

export const checkpointRecordSchema = z.looseObject({
  checkpointId: z.string().min(1),
  jobId: z.string().min(1),
  runId: z.string().min(1),
  activityId: z.string().nullable(),
  planId: z.string().min(1),
  planHash: z.string().min(1),
  type: z.enum(["after-upload", "after-parse", "on-page-change", "pre-submit"]),
  status: z.enum(["passed", "failed"]),
  results: z.array(checkpointResultSchema),
  missingKeyFields: z.array(z.string()),
  taskId: z.string(),
  createdAt: z.string(),
});

export const checkpointFileSchema = z
  .looseObject({
    checkpoints: z.array(checkpointRecordSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine((data) => new Set(data.checkpoints.map((c) => c.checkpointId)).size === data.checkpoints.length, {
    message: "checkpoints.json: duplicate checkpointId",
  });

// Submission attempts (execution protocol stage C, 2026-11-08):
// one record per attempt in data/attempts.json. An attempt is
// recorded BEFORE the submit click (write-ahead) and resolved
// afterwards; the Engine enforces one open attempt per job.
// Terminal statuses: confirmed, not-submitted, resolved-confirmed,
// resolved-not-submitted. applicationId is set by the Engine when
// APPLICATION_SUBMITTED consumes the attempt (idempotency).
export const attemptRecordSchema = z.looseObject({
  attemptId: z.string().min(1),
  jobId: z.string().min(1),
  runId: z.string().min(1),
  activityId: z.string().nullable(),
  planId: z.string().min(1),
  planHash: z.string().min(1),
  resumeVersion: z.string().min(1),
  checkpointSetHash: z.string().min(1),
  approvalRef: z.string().min(1),
  status: z.enum(["recorded", "confirmed", "not-submitted", "uncertain", "resolved-confirmed", "resolved-not-submitted", "escalated"]),
  outcome: z.string().nullable(),
  evidence: z.array(z.looseObject({ kind: z.string(), text: z.string() })),
  applicationId: z.string().nullable(),
  history: z.array(z.looseObject({ at: z.string(), action: z.string(), byTaskId: z.string() })),
  taskId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const attemptFileSchema = z
  .looseObject({
    attempts: z.array(attemptRecordSchema),
    version: z.number(),
    updatedAt: z.string(),
  })
  .refine((data) => new Set(data.attempts.map((a) => a.attemptId)).size === data.attempts.length, {
    message: "attempts.json: duplicate attemptId",
  });

// Ledger: header is the 19 columns from lib/ledger.ts. A row is
// checked by field count, not by re-parsing CSV here (parsing lives
// in lib/csv.ts and lib/ledger.ts and is not duplicated).
// - 19 fields: valid for new rows (INV-4).
// - 18 fields: known drift in existing rows on disk; reported as
//   knownDrift, never as a pass of INV-4 and never silently fixed.
// - anything else: invalid.
export const LEDGER_COLUMNS: readonly string[] = COLS;

export type LedgerFieldCheck =
  | { ok: true; knownDrift: false }
  | { ok: true; knownDrift: true }
  | { ok: false; knownDrift: false; reason: string };

export function checkLedgerFieldCount(fields: readonly string[]): LedgerFieldCheck {
  if (fields.length === COLS.length) return { ok: true, knownDrift: false };
  if (fields.length === COLS.length - 1)
    return { ok: true, knownDrift: true };
  return {
    ok: false,
    knownDrift: false,
    reason: `ledger row has ${fields.length} fields, expected ${COLS.length} (18 is known historical drift)`,
  };
}
