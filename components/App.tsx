"use client";

import { useEffect, useState } from "react";
import { ChevronRight, PanelLeft } from "lucide-react";
import Sidebar, { type View } from "./Sidebar";
import Dashboard from "./Dashboard";
import JobsApplicationsView from "./views/JobsApplicationsView";
import ResumesView from "./views/ResumesView";
import KnowledgeView from "./views/KnowledgeView";
import SkillView from "./views/SkillView";
import WorkflowView from "./views/WorkflowView";
import EngineView from "./views/EngineView";
import ActivityView from "./views/ActivityView";
import SettingsView from "./views/SettingsView";
import ChangelogView from "./views/ChangelogView";
import HelpView from "./views/HelpView";
import ReminderCard from "./ReminderCard";
import { usePipeline } from "./usePipeline";
import type { FullSnapshot } from "../lib/datafiles";
import { TERMINAL_APPLICATION_STAGES as TERMINAL_STAGES } from "../lib/task-state";

const TITLES: Record<View, string> = {
  today: "Today",
  "jobs-applications": "Jobs & Applications",
  resumes: "Resumes",
  knowledge: "Knowledge",
  skill: "Skill",
  workflow: "Workflow",
  engine: "Engine",
  activity: "Activity",
  changelog: "Changelog",
  settings: "Settings",
  help: "Product Manual",
};

const VIEW_IDS = Object.keys(TITLES) as View[];
// 干净路径：视图 ↔ URL 路径，today 对应根路径 /，其余对应 /<view>。
// 首屏视图由服务端路由传入（app/<view>/page.tsx 传 initialView），客户端首屏不再读
// window/location，因此服务端与客户端首屏一致，不会 hydration 报错，也不再需要 hash。
function viewToPath(v: View): string {
  return v === "today" ? "/" : `/${v}`;
}
function viewFromPath(p: string): View {
  const v = p.replace(/^\//, "");
  return v === "" ? "today" : (VIEW_IDS as string[]).includes(v) ? (v as View) : "today";
}

export default function App({ initial, initialView = "today" }: { initial: FullSnapshot; initialView?: View }) {
  // 首屏视图就是服务端渲染的视图，不读 window；导航只改状态＋pushState，刷新由路由兜底。
  const [view, setView] = useState<View>(initialView);
  const [jobFocus, setJobFocus] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(true);
  const { snap, synced, offline, note } = usePipeline(initial);
  // 后退/前进时按 URL 路径切视图。旧的 /#<view> 书签只在挂载时兼容一次：
  // 路径是 / 且 hash 是合法视图时转成干净路径，之后不再产生任何 #。
  useEffect(() => {
    if (window.location.pathname === "/") {
      const h = window.location.hash.replace(/^#/, "");
      if ((VIEW_IDS as string[]).includes(h)) {
        const v = h as View;
        window.history.replaceState(null, "", viewToPath(v));
        if (v !== initialView) setView(v);
      }
    }
    const onPop = () => setView(viewFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Badges 只显示未完成（需行动）的数量，不显示总数
  const jobsTodo = snap.jobs.jobs.filter((j) => j.status === "screening" || j.status === "approved").length;
  const appsTodo = snap.applications.applications.filter((a) => !(TERMINAL_STAGES as string[]).includes(a.stage)).length;
  // 导航是单向的：改状态的同时把干净路径写进地址栏（路径没变就不写，避免多余历史记录）。
  // 没有任何 effect 再反向写 URL，所以挂载时不会出现旧视图覆盖新视图的竞态。
  const goJob = (id: string) => {
    setJobFocus(id);
    setView("jobs-applications");
    if (window.location.pathname !== "/jobs-applications") window.history.pushState(null, "", "/jobs-applications");
  };
  const goView = (v: View) => {
    setView(v);
    if (v === "jobs-applications" && jobFocus) setJobFocus(null);
    const p = viewToPath(v);
    if (window.location.pathname !== p) window.history.pushState(null, "", p);
  };

  return (
    <div className="stage">
      <div className="win">
        <Sidebar view={view} onView={goView} badges={{ "jobs-applications": jobsTodo }} collapsed={!sideOpen} />
        <main className="main">
          <div className="top">
            <button className="ib" onClick={() => setSideOpen(!sideOpen)} title={sideOpen ? "收起侧边栏" : "展开侧边栏"}>
              <PanelLeft size={18} strokeWidth={1.6} />
            </button>
            <span>JobPipe</span>
            <ChevronRight size={14} />
            <span className="cur">{TITLES[view]}</span>
            <span className="sp" />
            <span className="pill">
              <i className={`dot live${offline ? " n" : ""}`} />
              {offline ? "Offline" : "Live"}
            </span>
            <span className="pill date">
              <i className="dot" />
              {snap.today} · 休斯顿
            </span>
          </div>
          {view === "today" && <Dashboard snap={snap} synced={synced} offline={offline} note={note} onJobClick={goJob} onGoActivity={() => goView("activity")} />}
          {view === "jobs-applications" && (
            <JobsApplicationsView
              jobs={snap.jobs.jobs}
              apps={snap.applications.applications}
              daily={snap.daily}
              targets={snap.dailyTargets}
              today={snap.today}
              onJobClick={goJob}
            />
          )}
          {view === "resumes" && <ResumesView files={snap.resumeFiles} blocks={snap.resumes.blocks} versions={snap.resumeVersions} jobs={snap.jobs.jobs} />}
          {view === "knowledge" && <KnowledgeView quirks={snap.quirks.quirks} />}
          {view === "skill" && <SkillView docs={snap.skillDocs} skill={snap.skill} />}
          {view === "settings" && <SettingsView />}
          {view === "engine" && <EngineView />}
          {view === "activity" && <ActivityView />}
          {view === "changelog" && <ChangelogView changelog={snap.changelog} jobs={snap.jobs.jobs} />}
          {view === "help" && <HelpView doc={snap.helpDoc} />}
          {view === "workflow" && (
            <WorkflowView
              versions={snap.resumeVersions}
              targets={snap.dailyTargets}
              stages={snap.stages}
              today={snap.today}
              onGo={goView}
            />
          )}
        </main>
      </div>
      <ReminderCard onGo={() => goView("activity")} />
    </div>
  );
}
