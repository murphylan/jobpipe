// Pure display helpers for the Activity console (Doc-07 v3/v4).
// No node imports: safe to import from client components and
// from lib/engine/console.ts alike. Stage order is the Doc-00
// pipeline order; colors are accents only, status text is
// always rendered alongside the color, never instead of it.

export const STAGES = [
  { id: "discovery", label: "发现", short: "发现" },
  { id: "screening", label: "筛选", short: "筛选" },
  { id: "tailoring", label: "定制", short: "定制" },
  { id: "review", label: "复查", short: "复查" },
  { id: "apply", label: "投递", short: "投递" },
  { id: "ledger", label: "记账", short: "记账" },
] as const;

export const STAGE_IDS: readonly string[] = STAGES.map((s) => s.id);

export const STAGE_LABELS: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.label]));

export const STAGE_SHORT: Record<string, string> = Object.fromEntries(STAGES.map((s) => [s.id, s.short]));

// Pre-v3 entries carry no stage; the view maps their kind to
// a stage for display only and never rewrites the data.
const KIND_STAGE: Record<string, string> = {
  screening: "screening",
  applying: "apply",
  "gmail-check": "review",
  recording: "ledger",
};

/** Effective stage of an entry: explicit stage wins, else the kind mapping, else null (unclassified). */
export function displayStage(kind: string, stage: unknown): string | null {
  if (typeof stage === "string" && STAGE_IDS.includes(stage)) return stage;
  return KIND_STAGE[kind] ?? null;
}

/** Stages after the current one, in pipeline order. Empty for ledger and for unclassified entries. */
export function remainingStages(stage: string | null): string[] {
  if (!stage) return [];
  const idx = STAGE_IDS.indexOf(stage);
  if (idx < 0) return [];
  return [...STAGE_IDS.slice(idx + 1)];
}

export const STATUS_LABELS: Record<string, string> = {
  running: "进行中",
  waiting: "等待中",
  done: "已完成",
  failed: "失败",
  interrupted: "运行信号过期，待恢复",
  open: "待处理",
  answered: "已答复",
  parked: "先放着",
};

// v4 colors: running is blue so it no longer shares the amber
// of waiting/open; the rest keep the v1 values.
export const STATUS_COLORS: Record<string, string> = {
  running: "#2563eb",
  waiting: "#8a6d00",
  done: "#1a7f37",
  failed: "#8b1a1a",
  interrupted: "#92400e",
  open: "#8a6d00",
  answered: "#1a7f37",
  parked: "#666",
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? "#333";
}

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// v7 抽屉复制桥：用户粘贴给 Muse 的一句话，让抽屉里的答复能传到等着的浏览器任务。
// decision 是抽屉里写的答复原文；先放着时传空串，文案固定为“先放着”。
// 问题原文原样放进括号，Muse 按问题匹配待定项，不用记编号。
export function buildRelayText(question: string, decision: string): string {
  const d = decision.trim();
  return `待定答复【${question}】：${d || "先放着"}`;
}

// 抽屉「交给 Muse 解决」复制桥：问答类待定项不要求用户自己找记录、组织答案。
// 用户复制这段指令发到聊天，Muse 查 JobPipe 记录 / Gmail / 简历与已确认事实后处理，
// 只有必须本人拍板的才问用户；关闭待定项仍走 decision-waiting 文件，由引擎入账。
export function buildSolveRequestText(w: {
  waitingId: string;
  question: string;
  context: string[];
  kind: string;
  sourceActivityId: string | null;
}): string {
  const lines = [
    `请帮我解决 JobPipe 的一个待定事项（waitingId：${w.waitingId}，类型：${w.kind}）。`,
    `问题：${w.question}`,
  ];
  if (w.context.length > 0) {
    lines.push("背景：");
    for (const c of w.context) lines.push(`- ${c}`);
  }
  if (w.sourceActivityId) lines.push(`来源活动：${w.sourceActivityId}`);
  lines.push(
    "要求：不要让我自己去找记录。请先查 JobPipe 的数据（jobs、applications、ledger、profile、简历、changelog）、我的 Gmail 和你已确认的事实，能查到的直接给答案并注明依据；只有真正需要我本人拍板的个人事实或取舍，才问我，并一次问完。解决后继续推进原来的流程；需要关闭这条待定事项时，按我确认的结果写入 decision-waiting-" + w.waitingId + ".json 并核对 waiting.json 状态。",
  );
  return lines.join("\n");
}

// Copyable restart instructions carry the current run identity to Muse.
export function buildRerunText(title: string, runtime?: { activityId: string; taskId: string; runId?: string }): string {
  const text = `重跑任务：${title.trim()}`;
  return runtime ? `${text}\nactivityId=${runtime.activityId}；请用新 runId 和 sequence=0 开始 running，restartOf=${runtime.runId ?? runtime.taskId}。` : text;
}

/** 相对时间（2026-11-07 用户定版）：永远相对显示，不回退为绝对时间。 */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "时间未知";
  const diff = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (diff < 5) return "刚刚";
  if (diff < 60) return `${diff} 秒前`;
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 30 * 86400) return `${Math.floor(diff / 86400)} 天前`;
  return `${Math.floor(diff / (30 * 86400))} 个月前`;
}
