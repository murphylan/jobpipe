// Pure functions for the Jobs view (R4). No I/O; see docs/skill/10-json-contracts.md.

export type JobStatus = "new" | "screening" | "approved" | "applied" | "dropped";
export type JobConclusion = "apply" | "drop" | "pending";

export type Job = {
  id: string;
  company: string;
  role: string;
  channel: string;
  location: string;
  remote: string;
  salaryPosted: string | null;
  salaryAnswer: number | null;
  matchPoints: string[];
  redFlags: string[];
  conclusion: JobConclusion;
  status: JobStatus;
  version?: number; // 单条记录版本（2026-10-31 补）
  updatedAt?: string;
  url?: string; // 统一用 url（2026-10-31 决策，替代 sourceUrl）
  description?: string;
};

/** Filter by status; "all" returns a copy of the whole list. Never mutates input. */
export function filterJobs(jobs: Job[], status: JobStatus | "all"): Job[] {
  return status === "all" ? [...jobs] : jobs.filter((j) => j.status === status);
}

/** Case-insensitive keyword search over company + role + id. Blank keyword returns all. */
export function searchJobs(jobs: Job[], keyword: string): Job[] {
  const k = keyword.trim().toLowerCase();
  if (!k) return [...jobs];
  return jobs.filter((j) => `${j.company} ${j.role} ${j.id}`.toLowerCase().includes(k));
}

/** Sort by updatedAt descending (newest first). Jobs without a timestamp go last. Never mutates input. */
export function sortJobsByTimeDesc(jobs: Job[]): Job[] {
  return [...jobs].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}

/**
 * Find duplicate jobs: same URL, or (when URL missing) same company+role (case-insensitive).
 * Jobs with different URLs are NOT considered duplicates even if company+role match.
 * Returns groups of duplicates (each group has 2+ jobs). Used by Discovery to avoid re-adding.
 */
export function findDuplicateJobs(jobs: Job[]): Job[][] {
  const byUrl = new Map<string, Job[]>();
  const byCompanyRoleNoUrl = new Map<string, Job[]>();
  for (const j of jobs) {
    if (j.url) {
      const g = byUrl.get(j.url) || [];
      g.push(j);
      byUrl.set(j.url, g);
    } else {
      const key = `${j.company.toLowerCase()}|${j.role.toLowerCase()}`;
      const g = byCompanyRoleNoUrl.get(key) || [];
      g.push(j);
      byCompanyRoleNoUrl.set(key, g);
    }
  }
  const dupes: Job[][] = [];
  for (const [, g] of byUrl) {
    if (g.length > 1) dupes.push(g);
  }
  for (const [, g] of byCompanyRoleNoUrl) {
    if (g.length > 1) dupes.push(g);
  }
  return dupes;
}

/**
 * Apply a screening update to a job, protecting approved/applied status.
 * If the job is already approved or applied, screening may only update
 * matchPoints/redFlags/updatedAt — never status or conclusion.
 * Returns the updated job (does not mutate input).
 */
export function applyScreeningUpdate(
  job: Job,
  update: Partial<Pick<Job, "matchPoints" | "redFlags" | "conclusion" | "status" | "salaryAnswer">>
): Job {
  const protected_ = job.status === "approved" || job.status === "applied";
  if (protected_) {
    // 已审批/已投递：只允许更新匹配点、风险点、薪资答案
    return {
      ...job,
      matchPoints: update.matchPoints ?? job.matchPoints,
      redFlags: update.redFlags ?? job.redFlags,
      salaryAnswer: update.salaryAnswer ?? job.salaryAnswer,
      updatedAt: new Date().toISOString(),
    };
  }
  return { ...job, ...update, updatedAt: new Date().toISOString() };
}
