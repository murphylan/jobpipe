import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

export function readHatchEnvironment(base: string) {
  const projectRoot = path.resolve(base), skillSource = path.join(projectRoot, "integrations/muse/hatch/jobpipe_executor");
  let lastContext: { at: string; digest: string } | null = null;
  let problem: string | null = null;
  const activity = path.join(base, "data/activity.json");
  if (existsSync(activity)) {
    try {
      const data = JSON.parse(readFileSync(activity, "utf8"));
      if (!Array.isArray(data.activities)) throw new Error("invalid activity");
      for (const row of data.activities) if (typeof row.contextDigest === "string" && typeof row.contextTaskId === "string" && Number.isFinite(Date.parse(row.createdAt)) && (!lastContext || Date.parse(row.createdAt) > Date.parse(lastContext.at))) lastContext = { at: row.createdAt, digest: row.contextDigest };
    } catch { problem = "活动记录无法读取，实际加载状态未知"; }
  }
  const installText = `请为 JobPipe 安装或更新 Hatch 自定义 Skill。先用 muse.skill_search 检查是否已有等价入口，不要创建重复 Skill。\n项目在我的 Mac 上：${projectRoot}，不是你的 Linux 路径。请通过实际可用的 Mac 设备文件通道读取 ${skillSource} 下 SKILL.md、skill.yaml、scripts/jobpipe.py 三个文件，将它们原样放入你的 ~/workspace/custom-skills/jobpipe_executor/ 对应位置。不要把业务规范正文复制到 Skill。\n在你的 ~/AGENTS.md 中保留原内容，仅补充 JobPipe 项目路径、该 Skill 指针，以及执行前必须重新请求 Engine 上下文的规则。不要复制个人秘密。\n完成后只做读取和帮助自检，不启动求职或向真实 inbox 灌演练事件。报告实际文件位置和是否可发现，不以文件存在声称业务已跑通。`;
  const taskText = `这是 JobPipe 任务。请先读取你的 jobpipe_executor Skill，通过 Mac 设备通道读取 ${projectRoot}/AGENTS.md 和 docs/skill/inbox-contract.md。按 Skill 生成 AGENT_CONTEXT_REQUESTED，确认 Engine Receipt 后加载快照，在第一条回复报告 digest、Knowledge 是否初始化、版本和条目数，再执行我的实际任务。所有进度、等待和业务结果通过 inbox 上报，逐条核对 Receipt。Engine 离线或上下文未加载时先停止，不绕过边界。`;
  return { projectRoot, skillSource, packageReady: ["SKILL.md", "skill.yaml", "scripts/jobpipe.py"].every(file => existsSync(path.join(skillSource, file))), lastContext, problem, installText, taskText };
}
