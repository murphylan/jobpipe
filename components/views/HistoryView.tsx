"use client";

import { useMemo } from "react";
import { Clock3 } from "lucide-react";
import type { Application, ChangelogFile, DailyFile, DailyTargetsFile } from "../../lib/datafiles";
import { INTERVIEW, REPLIED } from "../../lib/ledger";

const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : "0%");

export default function HistoryView({
  daily,
  targets,
  changelog,
  apps,
  today,
}: {
  daily: DailyFile;
  targets: DailyTargetsFile;
  changelog: ChangelogFile;
  apps: Application[];
  today: string;
}) {
  const dates = useMemo(() => Object.keys(daily.days).sort().slice(-7), [daily]);
  const max = Math.max(1, ...dates.map((d) => Math.max(targets.targets[d] ?? 20, daily.days[d].apply)));
  const rows = useMemo(
    () =>
      [...dates].reverse().map((d) => {
        const plan = targets.targets[d] ?? 20;
        const confirmed = daily.days[d].apply;
        const dayApps = apps.filter((a) => (a.appliedAt || "").slice(0, 10) === d);
        return {
          d,
          plan,
          confirmed,
          replies: dayApps.filter((a) => REPLIED.has(a.stage)).length,
          interviews: dayApps.filter((a) => INTERVIEW.has(a.stage)).length,
          note: d === today ? "进行中" : "—",
        };
      }),
    [dates, daily, targets, apps, today],
  );
  const logs = useMemo(() => [...changelog.entries].sort((a, b) => b.at.localeCompare(a.at)), [changelog]);

  return (
    <div className="content">
      <div className="head">
        <div className="hicon">
          <Clock3 size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>History</h1>
          </div>
          <p>历史记录 · 7 天计划 vs 实际 + 每日明细 + 变更日志</p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="ph mono">
          Last 7 days · plan vs confirmed
          <span className="r">
            <span className="leg">
              <i style={{ background: "#eceae5" }} /> plan
            </span>
            <span className="leg">
              <i style={{ background: "var(--green)" }} /> confirmed
            </span>
          </span>
        </div>
        <div className="hbars">
          {dates.map((d) => (
            <div className="hb" key={d}>
              <div className="pair">
                <i className="p" style={{ height: `${Math.round((100 * (targets.targets[d] ?? 20)) / max)}%` }} />
                <i className="a" style={{ height: `${Math.round((100 * daily.days[d].apply) / max)}%` }} />
              </div>
              <span>
                {d.slice(5)} · {daily.days[d].apply}
              </span>
            </div>
          ))}
          {!dates.length && <div className="empty">No daily data yet.</div>}
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="ph mono">Daily detail</div>
        <div className="inner">
          <div className="tr hist th mono">
            <span>Date</span>
            <span>Plan</span>
            <span>Done</span>
            <span>Rate</span>
            <span>Replies</span>
            <span>Interv.</span>
            <span>Note</span>
          </div>
          {rows.map((r) => (
            <div className="tr hist" key={r.d}>
              <span className="mono">{r.d}</span>
              <span className="mono">{r.plan}</span>
              <span className="mono">{r.confirmed}</span>
              <span className="mono">{pct(r.confirmed, r.plan)}</span>
              <span className="mono">{r.replies}</span>
              <span className="mono">{r.interviews}</span>
              <span>{r.note}</span>
            </div>
          ))}
          {!rows.length && <div className="empty">No daily data yet.</div>}
        </div>
      </div>

      <div className="panel">
        <div className="ph mono">Changelog</div>
        <div className="inner">
          {logs.map((e, i) => (
            <div className="kv" key={i}>
              <span className="k">{e.at.slice(0, 16).replace("T", " ")}</span>
              <span>{e.note}</span>
            </div>
          ))}
          {!logs.length && <div className="empty">No changelog entries yet.</div>}
        </div>
      </div>
    </div>
  );
}
