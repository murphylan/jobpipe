import { prepareResumeEvidence } from "./resume-evidence.ts";
import { atomicWriteFileSync as writeFileSync } from "./storage.ts";
// Stage 3 events, third batch: QUIRK_LEARNED, plus the
// supporting pieces for shadow mode and daily derivation.
// QUIRK_LEARNED appends one quirk to data/quirks.json
// (creating it if it does not exist; the dashboard currently
// falls back to a sample file, and an engine-written quirks
// file is the first step toward replacing that fallback).
// High-approval events (PROFILE_CHANGED, RESUME_IMPORTED,
// SKILL_REVISED) are NOT applied here: the daemon holds them
// as pending-approval until the user approves them through
// inbox/decisions/, which is the next batch's work.
import { existsSync } from "node:fs";
import path from "node:path";
import { commitFiles, readJsonFile, type EventResult, type GenericChangeSet } from "./events.ts";
import { changelogFileSchema, profileFileSchema, quirksFileSchema, resumeVersionsFileSchema, skillFileSchema } from "./schema.ts";
import { canonicalJson } from "./serialize.ts";

export const HIGH_APPROVAL_EVENTS = ["PROFILE_CHANGED", "RESUME_IMPORTED", "SKILL_REVISED", "APPLICATION_IMPORTED"] as const;

function writeChangelogEntry(baseDir: string, stamp: string, action: string, target: string, version: number, note: string): void {
  const changelogPath = path.join(baseDir, "data", "changelog.json");
  const parsed = existsSync(changelogPath)
    ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
    : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
  if (!parsed.success) throw new Error("changelog.json: invalid");
  const data = parsed.data as { entries: Record<string, unknown>[]; version: number };
  data.entries.push({ at: stamp, action, target, version, note });
  writeFileSync(changelogPath, canonicalJson({ ...data, version: data.version + 1, updatedAt: stamp }), "utf-8");
}

// These three run ONLY after a decisions file approves them
// (see daemon.ts). They are never applied from the inbox
// directly, and never without the user's approval quote.
export function applyProfileChanged(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const fields = Object.keys(cs.payload).filter((k) => k !== "taskId" && k !== "event");
  if (!fields.length) return { ok: false, errors: ["E_SCHEMA: PROFILE_CHANGED payload has no profile fields"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["profile.json", "changelog.json"], () => {
    const profilePath = path.join(baseDir, "data", "profile.json");
    const parsed = existsSync(profilePath)
      ? profileFileSchema.safeParse(readJsonFile(profilePath))
      : { success: true, data: { version: 0, updatedAt: "" } } as const;
    if (!parsed.success) throw new Error("profile.json: invalid");
    const profile = parsed.data as Record<string, unknown>;
    for (const field of fields) profile[field] = cs.payload[field];
    writeFileSync(profilePath, canonicalJson({ ...profile, version: (profile.version as number) + 1, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "profile-changed", "profile.json", (profile.version as number), `${cs.taskId} profile fields: ${fields.join(", ")}`);
    summary = `PROFILE_CHANGED ${fields.join(", ")}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyResumeImported(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const version = cs.payload.version;
  let evidence: ReturnType<typeof prepareResumeEvidence>;
  try { evidence = prepareResumeEvidence(baseDir, cs.taskId, cs.payload.file); }
  catch (e) { return { ok: false, errors: [e instanceof Error ? e.message : String(e)] }; }
  const file = evidence.file;
  if (typeof version !== "string" || version === "") return { ok: false, errors: ["E_SCHEMA: payload.version missing"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["resume-versions.json", "changelog.json", evidence.journalPath], () => {
    evidence.promote();
    const rvPath = path.join(baseDir, "data", "resume-versions.json");
    const parsed = resumeVersionsFileSchema.safeParse(readJsonFile(rvPath));
    if (!parsed.success) throw new Error("resume-versions.json: invalid");
    const rvData = parsed.data as { versions: Record<string, unknown>[]; version: number };
    if (rvData.versions.some((v) => v.version === version))
      throw new Error(`E_DUPLICATE: resume version ${version} already registered`);
    rvData.versions.push({ version, jobId: typeof cs.payload.jobId === "string" ? cs.payload.jobId : "imported", file, createdAt: stamp, note: typeof cs.payload.note === "string" ? cs.payload.note : "" });
    writeFileSync(rvPath, canonicalJson({ ...rvData, version: rvData.version + 1, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "resume-imported", "resume-versions.json", rvData.version, `${cs.taskId} imported ${version}`);
    summary = `RESUME_IMPORTED ${version}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applySkillRevised(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  if (typeof cs.payload.skillVersion !== "string" && !Array.isArray(cs.payload.changelog))
    return { ok: false, errors: ["E_SCHEMA: SKILL_REVISED needs skillVersion or a changelog list"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["skill.json", "changelog.json"], () => {
    const skillPath = path.join(baseDir, "data", "skill.json");
    const parsed = existsSync(skillPath)
      ? skillFileSchema.safeParse(readJsonFile(skillPath))
      : { success: true, data: { skillVersion: "", changelog: [], dependencies: [], version: 0, updatedAt: "" } } as const;
    if (!parsed.success) throw new Error("skill.json: invalid");
    const skill = parsed.data as { skillVersion: string; changelog: string[]; version: number };
    if (typeof cs.payload.skillVersion === "string") skill.skillVersion = cs.payload.skillVersion;
    if (Array.isArray(cs.payload.changelog)) skill.changelog = [...skill.changelog, ...(cs.payload.changelog as string[])];
    writeFileSync(skillPath, canonicalJson({ ...skill, version: skill.version + 1, updatedAt: stamp }), "utf-8");
    writeChangelogEntry(baseDir, stamp, "skill-revised", "skill.json", skill.version, `${cs.taskId} skill -> ${skill.skillVersion}`);
    summary = `SKILL_REVISED ${skill.skillVersion}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}

export function applyQuirkLearned(baseDir: string, cs: GenericChangeSet): EventResult {
  const stamp = cs.createdAt;
  const trigger = cs.payload.trigger;
  const action = cs.payload.action;
  if (typeof trigger !== "string" || trigger === "") return { ok: false, errors: ["E_SCHEMA: payload.trigger missing"] };
  if (typeof action !== "string" || action === "") return { ok: false, errors: ["E_SCHEMA: payload.action missing"] };
  let summary = "";
  const result = commitFiles(baseDir, cs.taskId, ["quirks.json", "changelog.json"], () => {
    const quirksPath = path.join(baseDir, "data", "quirks.json");
    const parsed = existsSync(quirksPath)
      ? quirksFileSchema.safeParse(readJsonFile(quirksPath))
      : { success: true, data: { quirks: [], version: 0, updatedAt: "" } } as const;
    if (!parsed.success) throw new Error("quirks.json: invalid");
    const quirksData = parsed.data as { quirks: Record<string, unknown>[]; version: number };
    const id = typeof cs.payload.id === "string" && cs.payload.id !== ""
      ? cs.payload.id
      : `quirk-${stamp.slice(0, 10)}-${quirksData.quirks.length + 1}`;
    if (quirksData.quirks.some((q) => q.id === id))
      throw new Error(`E_DUPLICATE: quirk ${id} already exists`);
    quirksData.quirks.push({
      id,
      trigger,
      action,
      source: typeof cs.payload.source === "string" ? cs.payload.source : cs.taskId,
      version: 1,
      updatedAt: stamp,
    });
    writeFileSync(quirksPath, canonicalJson({ ...quirksData, version: quirksData.version + 1, updatedAt: stamp }), "utf-8");
    const changelogPath = path.join(baseDir, "data", "changelog.json");
    const changelogParsed = existsSync(changelogPath)
      ? changelogFileSchema.safeParse(readJsonFile(changelogPath))
      : { success: true, data: { entries: [], version: 0, updatedAt: "" } } as const;
    if (!changelogParsed.success) throw new Error("changelog.json: invalid");
    const changelogData = changelogParsed.data as { entries: Record<string, unknown>[]; version: number };
    changelogData.entries.push({ at: stamp, action: "quirk-learned", target: "quirks.json", version: quirksData.version, note: `${cs.taskId} quirk ${id}` });
    writeFileSync(changelogPath, canonicalJson({ ...changelogData, version: changelogData.version + 1, updatedAt: stamp }), "utf-8");
    summary = `QUIRK_LEARNED ${id}`;
  });
  if (!result.ok) return result;
  return { ok: true, summary };
}
