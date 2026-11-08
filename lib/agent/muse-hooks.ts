import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { reportRuntime, type RuntimeReport } from "./runtime-report.ts";

export const MUSE_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure", "Stop", "SessionEnd"] as const;
/** Ignore raw tool input/output: it may contain passwords, browser form data and tokens. */
export function handleMuseHook(event: string, input: unknown, config: RuntimeReport, contextFile: string) {
  if (!MUSE_EVENTS.includes(event as typeof MUSE_EVENTS[number])) throw new Error("unsupported Muse hook");
  if (!existsSync(contextFile)) throw new Error("execution context missing");
  const context = JSON.parse(readFileSync(contextFile, "utf8"));
  const { digest, ...content } = context;
  if (digest !== createHash("sha256").update(JSON.stringify(content)).digest("hex")) throw new Error("execution context digest mismatch");
  if (context.workspace !== config.base || context.stage !== config.stage || !context.digest) throw new Error("execution context mismatch");
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("invalid hook input");
  const p = input as Record<string, unknown>;
  const session = p.session_id;
  if (typeof session !== "string" || !session) throw new Error("hook session_id required");
  const toolEvent = ["PreToolUse", "PostToolUse", "PostToolUseFailure"].includes(event);
  if (toolEvent && (typeof p.tool_use_id !== "string" || !p.tool_use_id)) throw new Error("hook tool_use_id required");
  // Repeated prompts/stops can occur in one session. Only tool calls and session lifecycle have stable IDs.
  const key = toolEvent ? `${session}:${event}:${p.tool_use_id}` : `${session}:${event}:${typeof p.prompt_id === "string" ? p.prompt_id : "session"}`;
  const stopped = event === "Stop" || event === "SessionEnd";
  reportRuntime(config, key, stopped ? "waiting" : "running", stopped
    ? "Muse 已停止本轮执行；等待业务证据或用户决策，不宣称投递成功"
    : `Muse ${event}；工具参数和输出未记录；上下文 ${context.digest.slice(0, 12)}`);
}
