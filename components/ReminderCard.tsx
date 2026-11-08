"use client";

import { useEffect, useState } from "react";

const SNOOZE_KEY = "jobpipe-reminder-snoozed-until";
const SNOOZE_MS = 15 * 60 * 1000;

// 右下角常驻提醒卡：待定队列有 open 项时一直挂着，事项清完自动消失。
// 不自动消失、不做模态拦截：页面其他部分照常用；“稍后再说”只 snooze 15 分钟，
// 到期重现，没有“一键关掉不管了”。snooze 只在挂载后读 localStorage，避免 hydration 错位。
export default function ReminderCard({ onGo }: { onGo: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState<{ waitingId: string; question: string }[]>([]);
  const [snoozedUntil, setSnoozedUntil] = useState(0);

  useEffect(() => {
    setMounted(true);
    try {
      setSnoozedUntil(Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0);
    } catch {
      /* 读不到就当没 snooze */
    }
    let stop = false;
    const tick = async () => {
      try {
        const j = (await (await fetch("/api/waiting", { cache: "no-store" })).json()) as {
          waiting?: { waitingId: string; question: string; status: string }[];
        };
        if (stop) return;
        setOpen((Array.isArray(j.waiting) ? j.waiting : []).filter((w) => w.status === "open"));
      } catch {
        /* 下一轮再试 */
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, []);

  const snooze = () => {
    const until = Date.now() + SNOOZE_MS;
    try {
      localStorage.setItem(SNOOZE_KEY, String(until));
    } catch {
      /* 写不进就只在本次会话生效 */
    }
    setSnoozedUntil(until);
  };

  // “去处理”直达待定队列：先写一次性 flag，Activity 页下一轮 waiting 数据到后切 tab 并打开第一项抽屉。
  const go = () => {
    try {
      localStorage.setItem("jobpipe-activity-auto-waiting", "1");
    } catch {
      /* 写不进就只切视图，不直达 */
    }
    onGo();
  };

  if (!mounted || open.length === 0 || Date.now() < snoozedUntil) return null;
  const shown = open.slice(0, 3);
  return (
    <div style={{ position: "fixed", right: 16, bottom: 16, zIndex: 40, background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.16)", padding: "12px 14px", width: "min(360px, 90vw)" }}>
      <div style={{ fontSize: 14, fontWeight: 600 }}>有 {open.length} 件事等你处理</div>
      <ul style={{ margin: "8px 0", paddingLeft: 18, fontSize: 13, color: "#333" }}>
        {shown.map((w) => (
          <li key={w.waitingId}>{w.question}</li>
        ))}
      </ul>
      {open.length > shown.length && <div style={{ fontSize: 13, color: "#666", marginBottom: 8 }}>还有 {open.length - shown.length} 项……</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={go} style={{ border: "1px solid #dbe7f3", borderRadius: 999, padding: "4px 12px", background: "#e8f1fb", color: "#2563eb", cursor: "pointer", fontSize: 13 }}>
          去处理 →
        </button>
        <button onClick={snooze} style={{ border: "1px solid #dbe7f3", borderRadius: 999, padding: "4px 12px", background: "#fff", cursor: "pointer", fontSize: 13 }}>
          稍后再说
        </button>
      </div>
    </div>
  );
}
