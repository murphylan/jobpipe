// Stage 1 expansion, dry-run only (Doc-00 sections 7.6 and 9).
// expandApplicationSubmitted takes a ChangeSet for the event
// APPLICATION_SUBMITTED, checks its guards against the current
// data on disk, and returns the operations the engine WOULD
// perform. It writes nothing. Real application is stage 2/3 work
// (inbox, receipts, journal, backup, commit); this function is
// the dry-run core those stages will call.
//
// Guards (error codes follow Doc-00 section 8.1 where they exist):
// - job must exist and be approved (E_GUARD:not-approved)
// - job.jdKind must be "full" (E_GUARD:jd-not-full); a missing
//   jdKind is not full, it is unknown, and unknown does not pass.
// - resume version must be registered and its PDF must exist on
//   disk. The PDF sha256 is computed and returned as evidence;
//   there is no stored hash to match against yet in
//   resume-versions.json, so full hash-match is a known gap
//   for a later stage, not a silent pass.
// - evidence must contain an employer confirmation and a user
//   approval entry (E_EVIDENCE_MISSING otherwise).
// - ledger id for the new row is max existing id + 1; if the
//   baseline in the ChangeSet disagrees with disk, the run
//   refuses (E_BASELINE_MISMATCH) instead of merging.
//
// Precedents followed from the current repo, not invented:
// - job entry version/updatedAt are NOT changed on a status flip;
//   only the file-level version increments (see 2026-10-31 practice).
// - changelog gets one entry per task listing all changed files,
//   as current entries do; the per-file reading of INV-10 is
//   flagged for the commit stage to decide, not settled here.
// - new application id is "<chicago-date>-<jobId>" (for example
//   2026-10-31-starbucks) and next action is the 7-day follow-up
//   used by existing ledger rows.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";
import { chicagoToday, family } from "../ledger.ts";
import { captureBaseline, checkBaseline, type Baseline } from "./baseline.ts";
import {
  applicationsFileSchema,
  attemptFileSchema,
  jobsFileSchema,
  resumeVersionsFileSchema,
} from "./schema.ts";

// FR-3: Registry-driven expansion. The registry (lib/engine/registry.yaml)
// is the source of truth for which events exist, whether they require
// user approval (Q-1), and which files they write. Handlers MUST check
// the registry first and refuse unknown events.
export type RegistryEvent = {
  name: string;
  description: string;
  requiresApproval: boolean;
  writes: string[];
  handler: string | null;
  note?: string;
};

type Registry = {
  version: number;
  events?: RegistryEvent[];
};

let registryCache: Registry | null = null;
let registryCacheDir: string | null = null;

/**
 * Load and parse registry.yaml (minimal YAML subset parser, no deps).
 * Parses the top-level `events:` list; each event is a flat map of
 * scalar keys (name, description, requiresApproval, handler, note)
 * plus a `writes:` string list. Cached per baseDir.
 */
export function loadRegistry(baseDir: string): Registry | null {
  if (registryCache && registryCacheDir === baseDir) return registryCache;
  const full = path.join(baseDir, "lib", "engine", "registry.yaml");
  if (!existsSync(full)) return null;
  try {
    const text = readFileSync(full, "utf-8");
    const events = parseRegistryEvents(text);
    const parsed: Registry = { version: 2, events };
    const m = text.match(/^version:\s*(\d+)/m);
    if (m) parsed.version = Number(m[1]);
    registryCache = parsed;
    registryCacheDir = baseDir;
    return parsed;
  } catch {
    return null;
  }
}

/** Minimal parser for the `events:` block in registry.yaml. */
function parseRegistryEvents(text: string): RegistryEvent[] {
  const lines = text.split("\n");
  const events: RegistryEvent[] = [];
  let inEvents = false;
  let current: Record<string, unknown> | null = null;
  let inWrites = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^events:\s*$/.test(line)) { inEvents = true; continue; }
    if (inEvents && /^\S/.test(line)) break; // next top-level key ends events block
    if (!inEvents) continue;
    const evMatch = line.match(/^  - name:\s*"?([^"]+)"?\s*$/);
    if (evMatch) {
      if (current) events.push(normalizeEvent(current));
      current = { name: evMatch[1].trim() };
      inWrites = false;
      continue;
    }
    if (!current) continue;
    const wStart = line.match(/^    writes:\s*$/);
    if (wStart) { inWrites = true; current.writes = []; continue; }
    if (inWrites) {
      const wItem = line.match(/^      -\s*"?([^"]+)"?\s*$/);
      if (wItem) { (current.writes as string[]).push(wItem[1].trim()); continue; }
      inWrites = false;
    }
    const kv = line.match(/^    (\w+):\s*(.*?)\s*$/);
    if (kv) {
      const [, k, v] = kv;
      if (k === "writes") {
        const writes = JSON.parse(v);
        if (!Array.isArray(writes) || !writes.every(item => typeof item === "string")) throw new Error("invalid registry writes");
        current[k] = writes;
      }
      else if (k === "requiresApproval") current[k] = v === "true";
      else if (k === "handler") current[k] = v === "null" ? null : v.replace(/^"|"$/g, "");
      else current[k] = v.replace(/^"|"$/g, "");
    }
  }
  if (current) events.push(normalizeEvent(current));
  return events;
}

function normalizeEvent(raw: Record<string, unknown>): RegistryEvent {
  return {
    name: String(raw.name ?? ""),
    description: String(raw.description ?? ""),
    requiresApproval: raw.requiresApproval === true,
    writes: Array.isArray(raw.writes) ? (raw.writes as string[]) : [],
    handler: (raw.handler as string | null) ?? null,
    note: raw.note ? String(raw.note) : undefined,
  };
}

/** Clear the registry cache (for tests). */
export function clearRegistryCache(): void {
  registryCache = null;
  registryCacheDir = null;
}

/** Get an event definition from the registry. Null if not found. */
export function getRegistryEvent(baseDir: string, eventName: string): RegistryEvent | null {
  const registry = loadRegistry(baseDir);
  if (!registry?.events) return null;
  return registry.events.find((e) => e.name === eventName) ?? null;
}

export type EvidenceEntry = { kind: string; text: string };
export type ApplicationSubmittedPayload = {
  jobId: string;
  resumeVersion: string;
  attemptId?: string;
  appliedAt?: string;
  score?: string;
  employmentType?: string;
  recruiter?: string;
  jdSnapshotPath?: string;
  notes?: string;
};
export type ChangeSetInput = {
  taskId: string;
  event: string;
  createdAt: string;
  baseline?: Baseline;
  payload: ApplicationSubmittedPayload;
  evidence: EvidenceEntry[];
};
export type Expansion = {
  job: Record<string, unknown>;
  jobsFileVersion: number;
  application: Record<string, unknown>;
  applicationsFileVersion: number;
  ledgerRow: string[];
  ledgerId: number;
  changelogEntry: Record<string, unknown>;
  dailyApplyPreview: number;
  today: string;
  resumePdfSha256: string;
  baseline: Baseline;
};
export type ExpandResult =
  | { ok: true; expansion: Expansion }
  | { ok: false; errors: string[] };

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function readJson(baseDir: string, rel: string): unknown | null {
  const full = path.join(baseDir, "data", rel);
  if (!existsSync(full)) return null;
  try {
    return JSON.parse(readFileSync(full, "utf-8"));
  } catch {
    return undefined;
  }
}

export function expandApplicationSubmitted(
  baseDir: string,
  changeset: ChangeSetInput,
  opts: { today?: string } = {},
): ExpandResult {
  const errors: string[] = [];
  const today = opts.today ?? chicagoToday();
  const { payload, evidence } = changeset;

  // FR-3: Registry-driven. The event MUST be defined in registry.yaml.
  const eventDef = getRegistryEvent(baseDir, changeset.event);
  if (!eventDef) {
    return { ok: false, errors: [`E_UNKNOWN_EVENT: ${changeset.event} is not defined in lib/engine/registry.yaml`] };
  }
  if (changeset.event !== "APPLICATION_SUBMITTED") {
    return { ok: false, errors: [`E_UNKNOWN_EVENT: ${changeset.event} (this handler supports APPLICATION_SUBMITTED only)`] };
  }
  if (eventDef.handler !== "expandApplicationSubmitted") {
    return { ok: false, errors: [`E_HANDLER_MISMATCH: registry maps ${changeset.event} to "${eventDef.handler}"`] };
  }  
  if (changeset.baseline) {
    const checked = checkBaseline(changeset.baseline, baseDir);
    if (!checked.ok) return { ok: false, errors: checked.mismatches.map((m) => `E_BASELINE_MISMATCH: ${m}`) };
  }

  const jobsRaw = readJson(baseDir, "jobs.json");
  if (jobsRaw === null) errors.push("jobs.json: missing");
  else if (jobsRaw === undefined) errors.push("jobs.json: corrupt");
  const jobsParsed = jobsRaw !== null && jobsRaw !== undefined ? jobsFileSchema.safeParse(jobsRaw) : null;
  if (jobsParsed && !jobsParsed.success) errors.push(...jobsParsed.error.issues.map((i) => `jobs.json: ${i.path.map(String).join(".")} ${i.message}`));
  const job = jobsParsed?.success ? jobsParsed.data.jobs.find((j) => j.id === payload.jobId) : undefined;
  if (jobsParsed?.success && !job) errors.push(`E_GUARD:not-found: job ${payload.jobId} does not exist`);
  if (job && job.status !== "approved") errors.push(`E_GUARD:not-approved: job ${payload.jobId} status is ${job.status}, expected approved`);
  if (job && (job as { jdKind?: string }).jdKind !== "full")
    errors.push(`E_GUARD:jd-not-full: job ${payload.jobId} jdKind is ${(job as { jdKind?: string }).jdKind ?? "missing"}, expected full`);

  const rvRaw = readJson(baseDir, "resume-versions.json");
  if (rvRaw === null) errors.push("resume-versions.json: missing");
  else if (rvRaw === undefined) errors.push("resume-versions.json: corrupt");
  const rvParsed = rvRaw !== null && rvRaw !== undefined ? resumeVersionsFileSchema.safeParse(rvRaw) : null;
  if (rvParsed && !rvParsed.success) errors.push(...rvParsed.error.issues.map((i) => `resume-versions.json: ${i.path.map(String).join(".")} ${i.message}`));
  const resumeVersion = rvParsed?.success ? rvParsed.data.versions.find((v) => v.version === payload.resumeVersion) : undefined;
  if (rvParsed?.success && !resumeVersion) errors.push(`E_GUARD:resume-not-registered: ${payload.resumeVersion}`);
  let resumePdfSha256 = "";
  if (resumeVersion) {
    if (!resumeVersion.file) errors.push(`E_GUARD:resume-no-file: ${payload.resumeVersion} has no file`);
    else {
      const pdfPath = path.join(baseDir, resumeVersion.file);
      if (!existsSync(pdfPath)) errors.push(`E_GUARD:resume-file-missing: ${resumeVersion.file} is not on disk`);
      else resumePdfSha256 = createHash("sha256").update(readFileSync(pdfPath)).digest("hex");
    }
  }

  const hasEmployer = evidence.some((e) => e.kind === "employer-confirmation" && e.text.trim() !== "");
  const hasApproval = evidence.some((e) => e.kind === "user-approval" && e.text.trim() !== "");
  if (!hasEmployer) errors.push("E_EVIDENCE_MISSING: no employer-confirmation evidence");
  if (!hasApproval) errors.push("E_EVIDENCE_MISSING: no user-approval evidence");

  const ledgerPath = path.join(baseDir, "data", "mirror", "ledger.csv");
  if (!existsSync(ledgerPath)) errors.push("ledger.csv: real mirror file missing");
  let ledgerRows: string[][] = [];
  let ledgerHeader: string[] = [];
  if (existsSync(ledgerPath)) {
    const parsed = parseCsv(readFileSync(ledgerPath, "utf-8").replace(/^\uFEFF/, "").trim());
    ledgerHeader = parsed[0] ?? [];
    ledgerRows = parsed.slice(1);
  }
  if (ledgerHeader.length !== 19) errors.push(`ledger.csv: header has ${ledgerHeader.length} columns, expected 19`);

  const appsGuardRaw = readJson(baseDir, "applications.json");
  if (appsGuardRaw === null) errors.push("applications.json: missing");
  else if (appsGuardRaw === undefined) errors.push("applications.json: corrupt");
  else {
    const appsGuardParsed = applicationsFileSchema.safeParse(appsGuardRaw);
    if (!appsGuardParsed.success)
      errors.push(...appsGuardParsed.error.issues.map((i) => `applications.json: ${i.path.map(String).join(".")} ${i.message}`));
  }

  // Stage C idempotency guard (execution protocol section 5): once a
  // job has submission attempts on record, APPLICATION_SUBMITTED must
  // cite one that ended confirmed / resolved-confirmed, and each
  // attempt can be consumed by at most one application. Jobs with no
  // attempts on record keep the pre-protocol path unchanged.
  const attemptsRaw = readJson(baseDir, "attempts.json");
  if (attemptsRaw === undefined) errors.push("attempts.json: corrupt");
  else if (attemptsRaw !== null) {
    const attemptsParsed = attemptFileSchema.safeParse(attemptsRaw);
    if (!attemptsParsed.success)
      errors.push(...attemptsParsed.error.issues.map((i) => `attempts.json: ${i.path.map(String).join(".")} ${i.message}`));
    else {
      const attempts = attemptsParsed.data.attempts;
      const attemptId = typeof payload.attemptId === "string" && payload.attemptId !== "" ? payload.attemptId : null;
      if (attemptId) {
        const attempt = attempts.find((a) => a.attemptId === attemptId);
        if (!attempt) errors.push(`E_ATTEMPT_UNKNOWN: attempt ${attemptId} is not on record`);
        else if (attempt.jobId !== payload.jobId) errors.push(`E_ATTEMPT_JOB_MISMATCH: attempt ${attemptId} belongs to job ${attempt.jobId}, not ${payload.jobId}`);
        else if (attempt.status !== "confirmed" && attempt.status !== "resolved-confirmed")
          errors.push(`E_ATTEMPT_NOT_CONFIRMED: attempt ${attemptId} status is ${attempt.status}, expected confirmed or resolved-confirmed`);
        else if (attempt.applicationId) errors.push(`E_ATTEMPT_CONSUMED: attempt ${attemptId} already produced application ${attempt.applicationId}`);
      } else if (attempts.some((a) => a.jobId === payload.jobId)) {
        errors.push(`E_ATTEMPT_REQUIRED: job ${payload.jobId} has submission attempts on record; APPLICATION_SUBMITTED must cite a confirmed attemptId`);
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const ids = ledgerRows.map((r) => Number(r[0])).filter((n) => Number.isFinite(n));
  const ledgerId = (ids.length ? Math.max(...ids) : 0) + 1;
  const appliedAt = payload.appliedAt ?? changeset.createdAt;
  const nextActionDue = addDays(today, 7);
  const employerText = evidence.find((e) => e.kind === "employer-confirmation")!.text;

  const jobOut: Record<string, unknown> = { ...(job as unknown as Record<string, unknown>), status: "applied" };
  const application: Record<string, unknown> = {
    id: `${today}-${payload.jobId}`,
    jobId: payload.jobId,
    ledgerRowId: String(ledgerId),
    resumeVersion: payload.resumeVersion,
    ...(payload.attemptId ? { attemptId: payload.attemptId } : {}),
    source: (job as { channel: string }).channel,
    collectedAt: changeset.createdAt,
    appliedAt,
    employerConfirmed: true,
    stage: "applied",
    nextAction: "等回复 · 7 天后跟进",
    nextActionDue,
    interviewAt: null,
    notes: payload.notes ?? "",
    version: 1,
    updatedAt: changeset.createdAt,
  };
  const ledgerRow = [
    String(ledgerId),
    today,
    (job as { company: string }).company,
    (job as { role: string }).role,
    (job as { url?: string }).url ?? "",
    (job as { channel: string }).channel,
    payload.score ?? "",
    family((job as { channel: string }).channel),
    payload.resumeVersion,
    payload.employmentType ?? "",
    "confirmed",
    employerText,
    "applied",
    today,
    payload.recruiter ?? "",
    "等回复 · 7 天后跟进",
    nextActionDue,
    payload.jdSnapshotPath ?? "",
    payload.notes ?? "",
  ];
  const appsRaw = readJson(baseDir, "applications.json");
  const appsParsed = appsRaw !== null && appsRaw !== undefined ? applicationsFileSchema.safeParse(appsRaw) : null;
  const applicationsVersion = appsParsed?.success ? appsParsed.data.version + 1 : 1;
  const jobsVersion = jobsParsed!.success ? jobsParsed!.data.version + 1 : 1;
  const confirmedToday = ledgerRows.filter((r) => r[1] === today && r[10] === "confirmed").length;

  return {
    ok: true,
    expansion: {
      job: jobOut,
      jobsFileVersion: jobsVersion,
      application,
      applicationsFileVersion: applicationsVersion,
      ledgerRow,
      ledgerId,
      changelogEntry: {
        at: changeset.createdAt,
        action: "application-submitted",
        target: "jobs.json, applications.json, mirror/ledger.csv",
        version: applicationsVersion,
        note: `${changeset.taskId} ${payload.jobId} approved -> applied, ledger ${ledgerId}`,
      },
      dailyApplyPreview: confirmedToday + 1,
      today,
      resumePdfSha256,
      baseline: captureBaseline(baseDir, ["jobs.json", "applications.json", "mirror/ledger.csv", "resume-versions.json", "daily.json"]),
    },
  };
}
