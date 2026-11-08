"use client";

import type { ReactNode } from "react";
import { Activity, BookOpen, Briefcase, CircleHelp, Cpu, FileText, GraduationCap, LayoutGrid, ListChecks, Settings } from "lucide-react";

export type View = "today" | "jobs-applications" | "resumes" | "knowledge" | "skill" | "workflow" | "engine" | "activity" | "changelog" | "settings" | "help";

const ITEMS: { id: View; label: string; icon: ReactNode }[] = [
  { id: "today", label: "Today", icon: <LayoutGrid size={18} strokeWidth={1.6} /> },
  { id: "jobs-applications", label: "Jobs & Applications", icon: <Briefcase size={18} strokeWidth={1.6} /> },
  { id: "resumes", label: "Resumes", icon: <FileText size={18} strokeWidth={1.6} /> },
  { id: "knowledge", label: "Knowledge", icon: <BookOpen size={18} strokeWidth={1.6} /> },
  { id: "skill", label: "Skill", icon: <GraduationCap size={18} strokeWidth={1.6} /> },
  { id: "workflow", label: "Workflow", icon: <ListChecks size={18} strokeWidth={1.6} /> },
  { id: "engine", label: "Engine", icon: <Cpu size={18} strokeWidth={1.6} /> },
  { id: "activity", label: "Activity", icon: <Activity size={18} strokeWidth={1.6} /> },
  { id: "settings", label: "Settings", icon: <Settings size={18} strokeWidth={1.6} /> },
  { id: "help", label: "Product Manual", icon: <CircleHelp size={18} strokeWidth={1.6} /> },
  // Changelog 不再进侧边栏（2026-11-08 用户定版）：它是审计黑匣子，记录留存于
  // data/changelog.json 即可，无需日常展示；页面与路由保留，需要时仍可直达。
];

export default function Sidebar({
  view,
  onView,
  badges,
  collapsed,
}: {
  view: View;
  onView: (v: View) => void;
  badges: Partial<Record<View, number>>;
  collapsed?: boolean;
}) {
  return (
    <aside className={`side${collapsed ? " collapsed" : ""}`}>
      <div className="box brand">
        <span className="logo" aria-label="JobPipe">
          <svg width="28" height="28" viewBox="0 0 64 64" role="img" aria-label="JobPipe" style={{ marginLeft: 0 }}>
            <g transform="rotate(-90 32 32)">
              <path d="M9 13 H45" fill="none" stroke="#00794c" strokeWidth="12" strokeLinecap="round" />
              <path d="M45 13 V32 H20" fill="none" stroke="#f58220" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20 32 V51 H39" fill="none" stroke="#e11b22" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M39 42.5 L57 51 L39 59.5 Z" fill="#e11b22" />
            </g>
          </svg>
        </span>
        {!collapsed && (
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <b>JobPipe</b>
            <small>求职管理</small>
          </div>
        )}
      </div>
      {!collapsed && <div className="lbl mono">Views</div>}
      {ITEMS.map((it) => (
        <button
          key={it.id}
          className={`nav${view === it.id ? " on" : ""}`}
          onClick={() => onView(it.id)}
          title={collapsed ? it.label : undefined}
        >
          {it.icon}
          {!collapsed && it.label}
          {!collapsed && badges[it.id] ? <span className="badge">{badges[it.id]}</span> : null}
          {collapsed && badges[it.id] ? <span className="cbadge">{badges[it.id]}</span> : null}
        </button>
      ))}
      <div className="bot">
        <div className="box me">
          <span aria-hidden="true" style={{ width: 30, height: 30, borderRadius: "50%", background: "#e2e8f0", display: "grid", placeItems: "center", flex: "none" }}>J</span>
          {!collapsed && (
            <div>
              <b>JobPipe</b>
              <small>本地工作区</small>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
