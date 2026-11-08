import { dataRoot } from "../../../lib/data-root.ts";
import { listActivity } from "../../../lib/engine/console";
import { readHeartbeatStatus } from "../../../lib/engine/heartbeat";
import { hasApplicationProof } from "../../../lib/engine/application-proof";
import { readTaskState } from "../../../lib/engine/task-state";
import { parseCsv } from "../../../lib/csv";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

type Issue = {
  type: "mismatch" | "backlog" | "rejected" | "unlinked" | "data";
  severity: "red" | "yellow";
  title: string;
  detail: string;
  jobId?: string;
  taskId?: string;
  activityIds?: string[];
  ledgerRowId?: string;
  taskIds?: string[];
};

export async function GET() {
  const baseDir = dataRoot();
  const issues: Issue[] = [];
  const now = Date.now();

  const activities = listActivity(baseDir, now);
  // Only explicit batch scope exempts non-application activity. Stage alone cannot establish scope.
  const unlinked = activities.filter(a => !a.jobId && !(a.scope === "batch" && a.stage && a.stage !== "apply" && a.kind !== "applying"));
  if (unlinked.length) issues.push({ type: "unlinked", severity: "yellow", title: "历史活动未关联岗位", detail: `${unlinked.length} 项活动缺少 jobId，无法自动核对；保留原始记录。`, activityIds: unlinked.map(a => a.activityId) });
  for (const a of activities) {
    if (a.stage === "apply" && a.recordedStatus === "done" && a.jobId && !hasApplicationProof(baseDir, a.jobId, a.refs))
      issues.push({ type: "mismatch", severity: "red", title: "活动与业务记账不一致", detail: `「${a.title}」缺少同岗位有效投递收据、申请或确认账本行`, jobId: a.jobId });
  }
  for (const detail of readTaskState(baseDir, now).issues)
    issues.push({ type: "data", severity: "yellow", title: "业务关联数据不可用", detail });
  // Ledger ↔ applications consistency: a confirmed ledger row must be
  // referenced by an application record, and an application's ledgerRowId
  // must exist in the ledger. Drift here is how submitted jobs once
  // lingered on Today with no appliedAt.
  try {
    const ledgerRows = parseCsv(readFileSync(path.join(baseDir, "data", "mirror", "ledger.csv"), "utf8")).slice(1);
    const ledgerIds = new Set(ledgerRows.map((r) => (r[0] ?? "").trim()).filter(Boolean));
    const appsData = JSON.parse(readFileSync(path.join(baseDir, "data", "applications.json"), "utf8")) as {
      applications?: Array<{ jobId?: string; ledgerRowId?: string }>;
    };
    const referenced = new Set<string>();
    for (const app of appsData.applications ?? []) {
      const rowId = (app.ledgerRowId ?? "").trim();
      if (!rowId) continue;
      referenced.add(rowId);
      // Legacy slug-style ids end in "-<rowId>": the row counts as referenced
      // (no duplicate yellow below), but the malformed reference itself is
      // still reported — it is what blocks stage sync for that application.
      const suffix = /-(\d+)$/.exec(rowId)?.[1];
      if (suffix && ledgerIds.has(suffix)) referenced.add(suffix);
      if (!ledgerIds.has(rowId))
        issues.push({
          type: "mismatch",
          severity: "red",
          title: "申请记录的台账行号不存在",
          detail: `申请 ${app.jobId ?? ""} 引用了台账中不存在的行号 ${rowId}；其阶段可能无法与台账同步。`,
          jobId: app.jobId,
          ledgerRowId: rowId,
        });
    }
    for (const r of ledgerRows) {
      const rowId = (r[0] ?? "").trim();
      if (!rowId || (r[10] ?? "").trim() !== "confirmed" || referenced.has(rowId)) continue;
      issues.push({
        type: "mismatch",
        severity: "yellow",
        title: "台账已确认行缺少申请记录",
        ledgerRowId: rowId,
        detail: `台账第 ${rowId} 行（${(r[2] ?? "").trim()} · ${(r[3] ?? "").trim()}，投递日期 ${(r[1] ?? "").trim()}）已确认投递，但 applications.json 中没有引用该行号的申请记录。`,
      });
    }
  } catch { /* ledger/applications unavailable; readTaskState issues above already surface data problems */ }
  const heartbeat = readHeartbeatStatus(baseDir, now);
  const stale: string[] = [];
  for (const sub of ["inbox", "inbox/decisions", "inbox/muse-live"]) {
    const dir = path.join(baseDir, "data", sub);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try { const st = statSync(path.join(dir, name)); if (st.isFile() && now - st.mtimeMs > 10 * 60 * 1000) stale.push(name); } catch { /* concurrent consumer */ }
    }
  }
  if (stale.length) issues.push({ type: "backlog", severity: "yellow", title: "收件箱积压", detail: `${stale.length} 个文件超过 10 分钟未处理；引擎${heartbeat.status === "online" ? "在线" : "无新鲜心跳"}` });

  const receiptsDir = path.join(baseDir, "data", "receipts");
  if (existsSync(receiptsDir)) {
    const files = readdirSync(receiptsDir).filter((f) => f.endsWith(".json"));
    const recentRejected: { taskId: string; summary: string }[] = [];
    for (const f of files) {
      const full = path.join(receiptsDir, f);
      try {
        const mtime = statSync(full).mtimeMs;
        if (now - mtime > 60 * 60 * 1000) continue;
        const receipt = JSON.parse(readFileSync(full, "utf-8")) as { taskId: string; status: string; summary: string };
        if (receipt.status === "rejected") {
          recentRejected.push({ taskId: receipt.taskId, summary: receipt.summary });
        }
      } catch { }
    }
    if (recentRejected.length > 0) {
      issues.push({
        type: "rejected",
        severity: "yellow",
        title: "最近有被拒事件",
        detail: `过去 1 小时 ${recentRejected.length} 个事件被拒`,
        taskId: recentRejected[0]?.taskId,
        taskIds: recentRejected.map(receipt => receipt.taskId),
      });
    }
  }

  return Response.json({ issues, checkedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
}
