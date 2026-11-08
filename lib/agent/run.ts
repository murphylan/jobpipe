import { unlinkSync } from "node:fs";
import path from "node:path";
import { atomicCreateFileSync } from "../engine/storage.ts";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { reportRuntime } from "./runtime-report.ts";
import { hasApplicationProof } from "../engine/application-proof.ts";
import { isSafeTaskId } from "../engine/envelope.ts";
import { STAGE_IDS } from "../activity-display.ts";

export type RunOptions = { base: string; command: string[]; title: string; stage: string; jobId?: string; activityId?: string; restartOf?: string; refs?: string[]; pulseMs?: number; env?: Record<string, string>; muse?: { contextFile: string; projectRoot: string } };
/** A heartbeat is tied to this real child process; no detached keep-alive daemon. */
export async function runWithActivity(opts: RunOptions): Promise<{ code: number; activityId: string; runId: string }> {
  if (!opts.command.length || !opts.title.trim() || !STAGE_IDS.includes(opts.stage) || (opts.pulseMs !== undefined && (opts.pulseMs < 1 || opts.pulseMs > 240_000))) throw new Error("command, title and valid stage required");
  const activityId = opts.activityId ?? `activity-${randomUUID()}`;
  const runId = `run-${randomUUID()}`;
  for (const id of [activityId, runId, opts.jobId, opts.restartOf].filter(x => x !== undefined)) if (!isSafeTaskId(id)) throw new Error("unsafe activity/job/run ID");
  let sequence = 0;
  const config = { base: opts.base, activityId, runId, stage: opts.stage, title: opts.title, jobId: opts.jobId };
  const emit = (status: string, note: string, evidence?: { kind: string; text: string }[]) => reportRuntime(config, `wrapper-${sequence++}`, status, note, {
    ...(status === "running" && sequence === 1 && opts.restartOf ? { restartOf: opts.restartOf } : {}),
    ...(opts.refs ? { refs: opts.refs } : {}),
  }, evidence);
  let child;
  try { child = spawn(opts.command[0], opts.command.slice(1), { cwd: opts.base, stdio: "inherit", shell: false, env: { ...process.env, ...opts.env, JOBPIPE_MUSE_REPORT: JSON.stringify(config) } }); }
  catch (e) { emit("failed", `无法启动任务进程：${String(e).slice(0, 180)}`); throw e; }
  let marker: string | undefined;
  let reportingError: Error | undefined;
  let pulse: ReturnType<typeof setInterval> | undefined;
  const progress = () => {
    try { reportRuntime(config, `wrapper-pulse-${sequence++}`, "running", "任务进程仍在运行；等待实际步骤或结束信号"); }
    catch (e) { reportingError = e instanceof Error ? e : new Error(String(e)); clearInterval(pulse); child.kill("SIGTERM"); }
  };
  const interrupt = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  let result: { code: number; signal?: string; error?: Error };
  try {
    result = await new Promise(resolve => {
      child.once("spawn", () => {
        try {
          if (opts.muse) {
            const candidate = path.join(opts.base, "data/inbox/.runtime", `muse-${child.pid}.json`);
            if (!atomicCreateFileSync(candidate, JSON.stringify({ ...config, ...opts.muse }))) throw new Error("Muse launch identity already exists");
            marker = candidate;
          }
          emit("running", "任务进程已启动；业务结果以 Receipt 为准"); pulse = setInterval(progress, opts.pulseMs ?? 60_000); }
        catch (e) { reportingError = e instanceof Error ? e : new Error(String(e)); child.kill("SIGTERM"); }
      });
      child.once("error", error => resolve({ code: 1, error }));
      child.once("exit", (code, signal) => resolve({ code: code ?? 1, signal: signal ?? undefined }));
    });
  } finally { clearInterval(pulse); process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt); if (marker) { try { unlinkSync(marker); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; } } }
  if (reportingError) throw reportingError;
  if (result.code !== 0 || result.signal || result.error) emit("failed", `任务进程未正常结束：${result.signal ?? result.error?.message ?? result.code}`.slice(0, 240));
  else if (opts.stage === "apply" && (!opts.jobId || !hasApplicationProof(opts.base, opts.jobId, opts.refs ?? []))) emit("waiting", "任务进程已结束，尚缺同岗位投递完成证明；不宣称投递成功");
  else emit("done", "任务进程已结束；此状态仅表示本次运行结束", [{ kind: "receipt", text: JSON.stringify({ source: "process-exit", observedAt: new Date().toISOString(), exitCode: 0, proves: "process completion only" }) }]);
  return { code: result.code, activityId, runId };
}
