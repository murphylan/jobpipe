import { existsSync, readFileSync, realpathSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { readMuseSettings, executableExists, type MuseSettings } from "./engine/muse-settings.ts";
import { assertMuseIntegration } from "./agent/muse-preflight.ts";

import { museCommands } from "./muse-commands.ts";
export function readMuseEnvironment(base: string) {
  const settings = readMuseSettings(base);
  const required = ["AGENTS.md", "docs/skill/inbox-contract.md", "scripts/muse-start.ts", "integrations/muse/jobpipe-observer/.muse-plugin/plugin.json"];
  const files = required.map(file => ({ file, exists: existsSync(path.join(base, file)) }));
  const activityFile = path.join(base, "data/activity.json");
  let signals: { context: string | null; tools: string | null; error: string | null } = { context: null, tools: null, error: null };
  if (existsSync(activityFile)) {
    try {
      const data = JSON.parse(readFileSync(activityFile, "utf8"));
      if (!Array.isArray(data.activities)) throw new Error("invalid activity");
      for (const a of data.activities) {
        if (typeof a.note !== "string" || typeof a.createdAt !== "string" || !Number.isFinite(Date.parse(a.createdAt))) continue;
        if (/^Muse SessionStart；/.test(a.note) && (!signals.context || Date.parse(a.createdAt) > Date.parse(signals.context))) signals.context = a.createdAt;
        if (/^Muse (PreToolUse|PostToolUse|PostToolUseFailure)；/.test(a.note) && (!signals.tools || Date.parse(a.createdAt) > Date.parse(signals.tools))) signals.tools = a.createdAt;
      }
    } catch { signals.error = "Activity 数据无法读取，信号状态未知"; }
  }
  return { settings, actualProjectRoot: path.resolve(base), bindingMatches: settings.projectRoot === path.resolve(base), files, executableExists: executableExists(settings.museBinary), signals, commands: museCommands(base, settings.museBinary) };
}
export type MuseEnvironment = ReturnType<typeof readMuseEnvironment>;
export type MuseProbe = { version: string | null; hooksApproved: boolean; skillRegistered: boolean; problems: string[]; checkedAt: string };
export type MuseRunner = (binary: string, args: string[], cwd: string) => Promise<string>;
const run: MuseRunner = async (binary, args, cwd) => (await promisify(execFile)(binary, args, { cwd, timeout: 5000, maxBuffer: 256 * 1024, encoding: "utf8" })).stdout;
/** Explicit authenticated check of committed configuration, never caller-provided executable input. */
export async function probeMuse(base: string, settings: MuseSettings, runner = run): Promise<MuseProbe> {
  const result: MuseProbe = { version: null, hooksApproved: false, skillRegistered: false, problems: [], checkedAt: new Date().toISOString() };
  if (settings.projectRoot !== path.resolve(base)) { result.problems.push("项目绑定路径已变化，请重新保存绑定"); return result; }
  try {
    const version = await runner(settings.museBinary, ["--version"], base);
    result.version = version.match(/Muse Code [\w.() -]+/)?.[0] ?? null;
    if (!result.version) result.problems.push("可执行文件未返回可识别的 Muse 版本");
  } catch { result.problems.push("无法执行 Muse 版本检查，请核对路径和权限"); return result; }
  try {
    const inventory = JSON.parse(await runner(settings.museBinary, ["plugins", "inspect", "jobpipe-observer", "--json"], base));
    try { assertMuseIntegration(inventory); result.hooksApproved = true; } catch { result.problems.push("插件钩子尚未全部获准，或插件清单不可用"); }
    const canonical = (p: string) => { try { return realpathSync(p); } catch { return path.resolve(p); } };
    const source = inventory.record?.source?.path;
    const sourceMatches = typeof source === "string" && canonical(source) === canonical(path.join(base, "integrations/muse/jobpipe-observer"));
    if (!sourceMatches) result.problems.push("插件来源未绑定当前项目，请按本页命令重新安装绑定");
    result.skillRegistered = sourceMatches && inventory.valid === true && inventory.active === true && inventory.plugin?.capabilities?.skills?.some((s: { id: string }) => s.id === "jobpipe-start") === true;
    if (!result.skillRegistered) result.problems.push("尚未注册 JobPipe 轻量入口 Skill，请重新安装当前插件");
  } catch { result.problems.push("未能读取 JobPipe 插件，请检查安装和工作区信任状态"); }
  return result;
}
