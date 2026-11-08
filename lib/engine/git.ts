import { assertSafeTaskId } from "./envelope.ts";
// Stage 2 Git step (Doc-00 section 9): local commits only.
// After a ChangeSet commits, its data files plus its receipt
// and run record are committed to the data repo on disk.
// This function NEVER pushes, never pulls, and never touches
// a remote. A Git failure does not roll back data; the caller
// records it on the receipt as git: failed, per Doc-00.
import { spawnSync } from "node:child_process";
import path from "node:path";

export type GitResult = { ok: boolean; detail: string };

export function commitDataGit(baseDir: string, taskId: string, files: readonly string[]): GitResult {
  const dataDir = path.join(baseDir, "data");
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const run = (args: string[]) => spawnSync("git", args, { cwd: dataDir, encoding: "utf-8", timeout: 30000, env });
  try {
    const add = run(["-C", dataDir, "add", ...files]);
    if (add.status !== 0) return { ok: false, detail: `git add failed: ${(add.stderr || add.stdout || "unknown").trim().slice(0, 200)}` };
    const commit = run([
      "-c", "user.email=engine@localhost", "-c", "user.name=jobpipe-engine",
      "-C", dataDir, "commit", "-m", `engine: ${taskId}`,
    ]);
    const out = (commit.stdout || "") + (commit.stderr || "");
    if (commit.status !== 0) {
      if (/nothing to commit/i.test(out)) return { ok: true, detail: "nothing to commit" };
      return { ok: false, detail: `git commit failed: ${out.trim().slice(0, 200)}` };
    }
    return { ok: true, detail: "committed" };
  } catch (e) {
    return { ok: false, detail: `git unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export function gitFilesForEvent(event: string, taskId: string): string[] {
  assertSafeTaskId(taskId);
  const dataFiles =
    event === "AGENT_CONTEXT_REQUESTED" ? [`agent-contexts/${taskId}.json`]
    : event === "APPLICATION_IMPORTED" ? ["applications.json", "changelog.json"]
    : event === "MUSE_SETTINGS_CHANGED" ? ["muse-settings.json"]
    : event === "KNOWLEDGE_CHANGED" ? ["knowledge.json"]
    : event === "PROFILE_CHANGED" ? ["profile.json", "changelog.json"]
    : event === "RESUME_IMPORTED" ? ["resume-versions.json", "changelog.json", `resume-files/${taskId}.pdf`]
    : event === "SKILL_REVISED" ? ["skill.json", "changelog.json"]
    : event === "QUIRK_LEARNED" ? ["quirks.json", "changelog.json"]
    : event === "TARGET_SET"
      ? ["daily-targets.json", "changelog.json"]
      : event === "FOLLOWUP_RECEIVED"
        ? ["applications.json", "mirror/ledger.csv", "changelog.json"]
        : event === "DISCOVERED" || event === "SCREENED" || event === "USER_DECIDED"
          ? ["jobs.json", "changelog.json", "daily.json"]
          : event === "TAILORED"
            ? ["resume-versions.json", "changelog.json", "daily.json", `resume-files/${taskId}.pdf`]
          : event === "AGENT_ACTIVITY" || event === "ACTIVITY_DELETED"
            ? ["activity.json", "changelog.json"]
          : event === "AGENT_WAITING" || event === "WAITING_ANSWERED" || event === "WAITING_DELETED"
            ? ["waiting.json", "changelog.json"]
          : event === "PLAN_RECORDED"
            ? ["plans.json", "changelog.json"]
          : event === "CHECKPOINT_RECORDED"
            ? ["checkpoints.json", "changelog.json"]
          : event === "ATTEMPT_RECORDED" || event === "ATTEMPT_RESOLVED"
            ? ["attempts.json", "changelog.json"]
          : ["jobs.json", "applications.json", "mirror/ledger.csv", "changelog.json", "daily.json", "attempts.json"];
  return [...dataFiles, `receipts/${taskId}.json`, `receipts/${taskId}.md`, `runs/${taskId}.json`];
}
