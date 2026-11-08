"use client";

import { ListChecks } from "lucide-react";
import type { DailyTargetsFile, ResumeVersionsFile } from "../../lib/datafiles";
import type { Snapshot } from "../../lib/pipeline";
import type { View } from "../Sidebar";

const PLATFORMS = [
  { name: "LinkedIn", role: "主攻", note: "remote 岗最多，每日筛新投递" },
  { name: "Indeed", role: "主攻", note: "remote 岗最多，每日筛新投递" },
  { name: "Dice", role: "维护", note: "已有曝光，只推例外强对口" },
  { name: "Kforce", role: "维护", note: "随 Dice 维护档" },
  { name: "Braintrust", role: "养着", note: "无配额，真正对口才投" },
];

export default function WorkflowView({
  versions,
  targets,
  stages,
  today,
  onGo,
}: {
  versions: ResumeVersionsFile;
  targets: DailyTargetsFile;
  stages: Snapshot["stages"];
  today: string;
  onGo: (v: View) => void;
}) {
  const base = versions.versions.find((v) => v.jobId === "base");
  const target = targets.targets[today] ?? 20;
  // 每步：英文名、中文名、今日计数、跳转视图、主导角色、参与分工。
  // 分工按新设计（Doc-00）：Muse 只写 inbox、Engine 是唯一写者、人工是唯一拍板人。
  const steps: [string, string, number | null, View, string, string][] = [
    ["Discovery", "发现职位", stages.discovery, "jobs-applications", "Muse", "Muse 找岗 · Engine 入账"],
    ["Screening", "筛选", stages.screening, "jobs-applications", "Muse", "Muse 筛选 · 待定项人工定"],
    ["Tailoring", "定制简历", stages.tailoring, "resumes", "Muse", "Muse 定制 · Engine 验简历"],
    ["Your review", "你的审核", stages.review, "jobs-applications", "人工", "人工拍板 · Engine 把门"],
    ["Apply", "投递", stages.apply, "jobs-applications", "Muse", "Muse 投递 · Engine 入账"],
    ["Ledger", "确认入账", null, "today", "Engine", "Engine 入账 · Muse 对账"],
  ];

  return (
    <div className="content">
      <div className="head">
        <div className="hicon">
          <ListChecks size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Workflow</h1>
          </div>
          <p>一轮流程 · 每日 {target} 投递 · 只读</p>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ padding: "10px 16px", fontSize: 11, letterSpacing: "0.08em", color: "#64748b", fontWeight: 500, borderBottom: "1px solid #eef3f9", background: "#fff" }}>本轮准备</div>
        <div style={{ padding: 0 }}>
          <div className="kv">
            <span className="k">1 · 简历</span>
            <span>
              {base ? (
                <>
                  <span className="pill">
                    <i className="dot" />
                    已上传
                  </span>{" "}
                  <span className="ver">{base.version}</span> {base.note}{" "}
                  <a className="btn" href={base.file ? `/api/resume-file?path=${encodeURIComponent(base.file.split("/").pop() || "")}` : "#"}>
                    预览
                  </a>{" "}
                  <button className="btn" onClick={() => onGo("resumes")}>
                    去 Resumes →
                  </button>
                </>
              ) : (
                <span className="pill">
                  <i className="dot n" />
                  未上传
                </span>
              )}
            </span>
          </div>
          <div className="kv">
            <span className="k">2 · 目标平台</span>
            <span>
              {PLATFORMS.map((p) => (
                <span key={p.name} style={{ display: "inline-block", margin: "0 14px 6px 0" }}>
                  <b>{p.name}</b>{" "}
                  <span className="pill">
                    <i className={`dot ${p.role === "主攻" ? "" : p.role === "维护" ? "w" : "k"}`} />
                    {p.role}
                  </span>
                  <br />
                  <small style={{ color: "var(--mut)" }}>{p.note}</small>
                </span>
              ))}
            </span>
          </div>
          <div className="kv">
            <span className="k">3 · 邮箱</span>
            <span>
              <small style={{ color: "var(--mut)" }}>请在 Muse 中核对已授权邮箱，用于接收雇主来信；此处不代表连接状态。</small>
            </span>
          </div>
          <div className="kv">
            <span className="k">4 · 今日目标</span>
            <span>
              <b style={{ fontSize: 20 }}>{target}</b> <small style={{ color: "var(--mut)" }}>daily-targets.json{today in targets.targets ? "" : "（默认）"}</small>
            </span>
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid #eef3f9", background: "#fff" }}>
          <span style={{ fontSize: 11, letterSpacing: "0.08em", color: "#64748b", fontWeight: 500 }}>执行步骤</span>
          <button onClick={() => onGo("today")} style={{ fontSize: 12, padding: "4px 12px", border: "1px solid #e2e8f0", borderRadius: 6, background: "#fff", color: "#2563eb", cursor: "pointer" }}>
            去 Today 看实时进度 →
          </button>
        </div>
        <div style={{ padding: "16px" }}>
          <div className="pipe">
            {steps.map(([name, desc, count, v, lead, actors], i) => (
              <div className="pnode-wrap" key={name}>
                <button className="pnode" onClick={() => onGo(v)} title={`去 ${v === "today" ? "Today" : v === "jobs-applications" ? "Jobs & Applications" : v === "resumes" ? "Resumes" : v}`}>
                  <span className="pnum">{i + 1}</span>
                  <b>{name}</b>
                  <small>{desc}</small>
                  <span className="pill">主导：{lead}</span>
                  <small style={{ textAlign: "center" }}>{actors}</small>
                  {count !== null && <span className="pcount">{count}</span>}
                </button>
                {i < steps.length - 1 && (
                  <span className="parr">→</span>
                )}
              </div>
            ))}
          </div>
          <div style={{ padding: "0 16px 14px", color: "var(--mut)", fontSize: 12 }}>
            审批门在第 4 步之后、第 5 步之前：没有人工在聊天里手输原话批准，Engine 拒绝提交（E_GUARD:not-approved），看板本身不批、也不直写数据。
          </div>
        </div>
      </div>

      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, overflow: "hidden", marginTop: 14 }}>
        <div style={{ padding: "10px 16px", fontSize: 11, letterSpacing: "0.08em", color: "#64748b", fontWeight: 500, borderBottom: "1px solid #eef3f9", background: "#fff" }}>业务逻辑 · 三方分工</div>
        <div style={{ padding: "8px 14px" }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, fontSize: 13 }}>
            <span className="pill">Muse：发现 · 筛选 · 定制 · 执行投递</span>
            <span>→</span>
            <span className="pill">inbox：事件＋证据</span>
            <span>→</span>
            <span className="pill">Engine：守卫 → 展开 → 校验 → 备份 → 提交 → 验证 → Git → 回执</span>
            <span>→</span>
            <span className="pill">data/：jobs · applications · ledger · daily</span>
            <span>→</span>
            <span className="pill">看板：只读</span>
          </div>
          <div style={{ marginTop: 10 }}>
            <div className="kv">
              <span className="k">Muse</span>
              <span>唯一事件生产者：只写 data/inbox/，不直写 data/；投递动作在雇主站执行，入账靠 Engine。</span>
            </div>
            <div className="kv">
              <span className="k">Engine</span>
              <span>唯一写者：单写者加锁；无批准证据拒绝提交；daily 计数由 runs＋ledger 派生，不手数。</span>
            </div>
            <div className="kv">
              <span className="k">人工</span>
              <span>唯一拍板人：批准必须在聊天里手输原话；法律同意、验证码、证件只本人处理。</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
