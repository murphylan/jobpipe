import { readProductManual } from "./product-manual.ts";
import * as contracts from "./engine/schema.ts";
import fs from "node:fs";
import path from "node:path";
import type { Job } from "./jobs";
import type { Snapshot } from "./pipeline";
import { readTaskState } from "./engine/task-state.ts";
import { TERMINAL_APPLICATION_STAGES } from "./task-state.ts";
import { parseCsv } from "./csv.ts";

/**
 * Read only real data/<name>.json, otherwise return the empty fallback.
 * Never throws: a corrupt file yields the fallback (docs/skill/20-write-rules.md #6).
 */
export function readJsonFile<T>(baseDir: string, name: string, fallback: T): T {
  return readJsonFileWithSource(baseDir, name, fallback).data;
}

/** Data provenance: where the returned data came from. */
export type DataSource = "real" | "sample" | "missing" | "corrupt";

/**
 * Like readJsonFile but also reports the data source.
 * - "real": data/<name>.json exists and parsed OK
 * - "sample": reserved for explicit demo readers; never returned here
 * - "missing": the real file is absent
 * - "corrupt": data/<name>.json exists but failed to parse
 * Callers MUST check source before treating data as real.
 */
export function readJsonFileWithSource<T>(
  baseDir: string,
  name: string,
  fallback: T
): { data: T; source: DataSource } {
  const realPath = path.join(baseDir, "data", name);

  if (fs.existsSync(realPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(realPath, "utf-8"));
      if (data === null || typeof data !== "object" || Array.isArray(data)) throw new Error("invalid object");
      if (fallback && typeof fallback === "object") {
        for (const [key, value] of Object.entries(fallback)) {
          if (Array.isArray(value) && !Array.isArray(data[key])) throw new Error(`invalid ${key}`);
          if (value && typeof value === "object" && !Array.isArray(value) && (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key]))) throw new Error(`invalid ${key}`);
        }
      }
      return { data: data as T, source: "real" };
    } catch {
      return { data: fallback, source: "corrupt" };
    }
  }
  return { data: fallback, source: "missing" };
}

export type SkillDoc = { id: string; title: string; path: string; body: string };

/** All docs/skill/*.md, sorted by filename. Missing dir -> []. */
export function readSkillDocs(baseDir: string): SkillDoc[] {
  const dir = path.join(baseDir, "docs/skill");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => {
      const body = fs.readFileSync(path.join(dir, f), "utf-8");
      const title =
        body
          .split("\n")
          .find((l) => l.startsWith("# "))
          ?.slice(2)
          .trim() || f.replace(/\.md$/, "");
      return { id: f.replace(/\.md$/, ""), title, path: `docs/skill/${f}`, body };
    });
}

// ---- JSON contracts (mirror docs/skill/10-json-contracts.md) ----

export type JobsFile = { version: number; updatedAt: string; jobs: Job[] };
export type ResumeVersion = { version: string; jobId: string; file: string | null; createdAt: string; note: string; fileExists?: boolean };
export type ResumeVersionsFile = { version: number; updatedAt: string; versions: ResumeVersion[]; selected: Record<string, string> };
export type Quirk = { id: string; trigger: string; action: string; source: string; version: number; updatedAt: string };
export type QuirksFile = { version: number; updatedAt: string; quirks: Quirk[] };
export type AppStage = "todo" | "applied" | "replied" | "screen" | "interview" | "offer" | "rejected" | "rejected_after_contact" | "withdrawn" | "ghosted";
/** 终态：不再产生跟进提醒 */
export const TERMINAL_STAGES = TERMINAL_APPLICATION_STAGES as AppStage[];
export type Application = {
  id: string;
  jobId: string;
  ledgerRowId: string | null; // 关联 ledger.csv 行；未确认投递时为 null（2026-10-31 设计）
  resumeVersion: string;
  source: string;
  collectedAt: string;
  appliedAt: string | null;
  employerConfirmed: boolean;
  stage: AppStage;
  nextAction: string | null;
  nextActionDue: string | null;
  interviewAt: string | null;
  notes: string;
  version: number;
  updatedAt: string;
};
export type ApplicationsFile = { version: number; updatedAt: string; applications: Application[] };
export type SkillFile = { version: number; updatedAt: string; skillVersion: string; changelog: string[]; dependencies: string[] };
export type DailyTargetsFile = { version: number; updatedAt: string; targets: Record<string, number> };
export type DailyStages = { discovery: number; screening: number; tailoring: number; review: number; apply: number };
export type DailyFile = { version: number; updatedAt: string; days: Record<string, DailyStages> };
export type ChangelogEntry = { at: string; action: string; target: string; version: number; note: string };
export type ChangelogFile = { entries: ChangelogEntry[] };
export type MuseLiveFile = {
  version: number;
  updatedAt: string;
  live: Record<string, { state: "working" | "waiting_user"; detail: string; updatedAt: string }>;
};

export type ResumeBlock = {
  id: string;
  kind: "skill" | "project" | "summary" | "experience" | "education";
  title: string;
  body: string;
  source: string; // 来源简历版本
  sourceFile?: string; // 来源文件路径（2026-10-31 Batch 7.1）
  sourceSection?: string; // 来源章节
  verificationStatus?: string; // 验证状态
  version: number;
  updatedAt: string;
};
export type ResumesFile = { version: number; updatedAt: string; blocks: ResumeBlock[] };
export type ProfileFile = { version: number; updatedAt: string; legalFirstName: string; legalLastName: string; preferredName: string; email: string; phone: string; address: { line1: string; city: string; state: string; zip: string; country: string }; linkedin: string; github: string };

/**
 * Resumes 页的物理文件清单：页面只列 data/resume-files/
 * 里实际存在的 PDF，每个文件注明被引用次数——引用分三路统计：版本记录
 * （resume-versions.json 的 file 指向它）、投递记录（applications.json 的
 * resumeVersion 经版本记录映射到它）、台账（ledger.csv 的 resume_version 同样映射）。
 * 只有记录、文件已不在磁盘上的版本不出现在此清单里。
 */
export type ResumeFileEntry = {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  versions: string[];
  recordRefs: number;
  applicationRefs: number;
  ledgerRefs: number;
  totalRefs: number;
};

export function buildResumeFiles(
  baseDir: string,
  versionsFile: ResumeVersionsFile,
  applicationsFile: ApplicationsFile
): ResumeFileEntry[] {
  const dir = path.join(baseDir, "data", "resume-files");
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.toLowerCase().endsWith(".pdf"))
    .filter((n) => {
      try {
        return fs.statSync(path.join(dir, n)).isFile();
      } catch {
        return false;
      }
    })
    .sort();
  const present = new Set(names.map((n) => n.toLowerCase()));
  // 版本记录 -> 物理文件（按文件名匹配，大小写不敏感：macOS 文件系统口径）
  const versionsByFile = new Map<string, string[]>();
  const fileByVersion = new Map<string, string>();
  for (const v of versionsFile.versions) {
    if (!v.file) continue;
    const base = v.file.split("/").pop() || "";
    const key = base.toLowerCase();
    if (!present.has(key)) continue;
    const list = versionsByFile.get(key) || [];
    list.push(v.version);
    versionsByFile.set(key, list);
    fileByVersion.set(v.version, key);
  }
  const appRefs = new Map<string, number>();
  for (const a of applicationsFile.applications) {
    const key = a.resumeVersion ? fileByVersion.get(a.resumeVersion) : undefined;
    if (key) appRefs.set(key, (appRefs.get(key) || 0) + 1);
  }
  const ledgerRefs = new Map<string, number>();
  try {
    const ledgerPath = path.join(baseDir, "data", "mirror", "ledger.csv");
    if (fs.existsSync(ledgerPath)) {
      const rows = parseCsv(fs.readFileSync(ledgerPath, "utf-8").replace(/^\uFEFF/, ""));
      const col = rows.length ? rows[0].indexOf("resume_version") : -1;
      if (col >= 0) {
        for (const row of rows.slice(1)) {
          const key = row[col] ? fileByVersion.get(row[col]) : undefined;
          if (key) ledgerRefs.set(key, (ledgerRefs.get(key) || 0) + 1);
        }
      }
    }
  } catch {
    // 台账读不到时只少一路计数，不让整个清单失败
  }
  return names
    .map((name) => {
      const key = name.toLowerCase();
      const st = fs.statSync(path.join(dir, name));
      const versions = versionsByFile.get(key) || [];
      const recordRefs = versions.length;
      const applicationRefs = appRefs.get(key) || 0;
      const ledgerCount = ledgerRefs.get(key) || 0;
      return {
        name,
        path: `data/resume-files/${name}`,
        sizeBytes: st.size,
        modifiedAt: st.mtime.toISOString(),
        versions,
        recordRefs,
        applicationRefs,
        ledgerRefs: ledgerCount,
        totalRefs: recordRefs + applicationRefs + ledgerCount,
      };
    })
    .sort((a, b) => b.totalRefs - a.totalRefs || a.name.localeCompare(b.name));
}

/**
 * Everything /api/pipeline returns on top of the ledger snapshot.
 * Shared by the route and app/page.tsx so the server render and the API agree.
 */
export function loadFullSnapshotData(baseDir: string) {
  const schemas: Record<string, { safeParse: (value: unknown) => { success: boolean } }> = {
    "jobs.json": contracts.jobsFileSchema, "applications.json": contracts.applicationsFileSchema,
    "resume-versions.json": contracts.resumeVersionsFileSchema, "resumes.json": contracts.resumesFileSchema,
    "profile.json": contracts.profileFileSchema, "quirks.json": contracts.quirksFileSchema,
    "skill.json": contracts.skillFileSchema, "daily-targets.json": contracts.dailyTargetsFileSchema,
    "daily.json": contracts.dailyFileSchema, "changelog.json": contracts.changelogFileSchema,
  };
  function validated<T>(name: string, fallback: T) {
    const result = readJsonFileWithSource(baseDir, name, fallback);
    if (result.source === "real" && schemas[name] && !schemas[name].safeParse(result.data).success) return { data: fallback, source: "corrupt" as DataSource };
    return result;
  }

  // jobs.json 来源必须外露：解析失败时看板不得静默显示空 Jobs（2026-11-01 事故）。
  const jobsSrc = validated<JobsFile>("jobs.json", { version: 0, updatedAt: "", jobs: [] });
  const sources: Record<string, DataSource> = { "jobs.json": jobsSrc.source };
  function read<T>(base: string, name: string, fallback: T): T {
    const result = validated(name, fallback);
    sources[name] = result.source;
    return result.data;
  }
  const applicationsFile = read<ApplicationsFile>(baseDir, "applications.json", { version: 0, updatedAt: "", applications: [] });
  const resumeVersionsFile = ((): ResumeVersionsFile => {
    const rv = read<ResumeVersionsFile>(baseDir, "resume-versions.json", {
      version: 0,
      updatedAt: "",
      versions: [],
      selected: {},
    });
    // PDF 缺失提示必须按磁盘实际显示，不能只看 file 字段（2026-11-01）。
    return {
      ...rv,
      versions: rv.versions.map((v) => ({
        ...v,
        fileExists: !!v.file && fs.existsSync(path.isAbsolute(v.file) ? v.file : path.join(baseDir, v.file)),
      })),
    };
  })();
  return {
    sources,
    applicationsSource: validated("applications.json", { applications: [] }).source,
    taskState: readTaskState(baseDir),
    jobs: jobsSrc.data,
    jobsSource: jobsSrc.source,
    applications: applicationsFile,
    resumeVersions: resumeVersionsFile,
    resumeFiles: buildResumeFiles(baseDir, resumeVersionsFile, applicationsFile),
    resumes: read<ResumesFile>(baseDir, "resumes.json", { version: 0, updatedAt: "", blocks: [] }),
    profile: read<ProfileFile | null>(baseDir, "profile.json", null),
    quirks: read<QuirksFile>(baseDir, "quirks.json", { version: 0, updatedAt: "", quirks: [] }),
    skill: read<SkillFile>(baseDir, "skill.json", { version: 0, updatedAt: "", skillVersion: "", changelog: [], dependencies: [] }),
    dailyTargets: read<DailyTargetsFile>(baseDir, "daily-targets.json", { version: 0, updatedAt: "", targets: {} }),
    daily: read<DailyFile>(baseDir, "daily.json", { version: 0, updatedAt: "", days: {} }),
    changelog: read<ChangelogFile>(baseDir, "changelog.json", { entries: [] }),
    skillDocs: readSkillDocs(baseDir),
    // Muse 实时状态（引擎写的 data/muse-live.json；Muse 经 inbox staging 间接更新）
    museLive: read<MuseLiveFile>(baseDir, "muse-live.json", { version: 0, updatedAt: "", live: {} }),
    // Optional private manual is configured per installation, never embedded in public source.
    helpDoc: readProductManual(),
  };
}

export type FullSnapshot = Snapshot & ReturnType<typeof loadFullSnapshotData>;
