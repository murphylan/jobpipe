import { parseCsv } from "./csv.ts";

export const COLS = ["id", "date_submitted", "company", "role", "req_url", "channel", "score", "role_family", "resume_version", "employment_type", "submission_status", "evidence", "stage", "last_contact_date", "recruiter", "next_action", "next_action_date", "jd_snapshot_path", "notes"] as const;
export type Row = Record<(typeof COLS)[number], string>;
export type Funnel = { by: string; groups: { key: string; apps: number; replies: number; interviews: number; ghosted: number }[]; total: { apps: number; replies: number; interviews: number; ghosted: number } };
export type Flag = { level: "error" | "warn" | "todo"; text: string; id?: string };

// Same definitions as scripts/funnel.py (skill). Change both together.
export const REPLIED = new Set(["replied", "screen", "interview", "offer", "rejected_after_contact"]);
export const INTERVIEW = new Set(["interview", "offer"]);
export const STATUSES = ["confirmed", "platform_flag", "incomplete"];
export const CAPS: Record<string, number> = { LinkedIn: 15, Indeed: 20 }; // playbook.md section 4 (adjustable)

export function parseLedger(text: string): Row[] {
  const [h, ...rest] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!h) return [];
  const keys = h.map((x) => x.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])) as Row);
}

export function band(score: string): string {
  const n = Number(score.trim());
  if (score.trim() === "" || Number.isNaN(n)) return "self/none";
  return n >= 9 ? "9-10" : n >= 7 ? "7-8.9" : n >= 5 ? "5-6.9" : "<5";
}

export function funnelBy(rows: Row[], by: "score_band" | "channel" | "resume_version" | "role_family"): Funnel {
  const m = new Map<string, number[]>();
  for (const r of rows) {
    if (r.submission_status !== "confirmed") continue;
    const key = by === "score_band" ? band(r.score) : r[by] || "?";
    const g = m.get(key) ?? [0, 0, 0, 0];
    g[0]++; g[1] += +REPLIED.has(r.stage); g[2] += +INTERVIEW.has(r.stage); g[3] += +(r.stage === "ghosted");
    m.set(key, g);
  }
  const groups = [...m.keys()].sort().map((key) => { const [apps, replies, interviews, ghosted] = m.get(key)!; return { key, apps, replies, interviews, ghosted }; });
  const sum = (k: "apps" | "replies" | "interviews" | "ghosted") => groups.reduce((a, g) => a + g[k], 0);
  return { by, groups, total: { apps: sum("apps"), replies: sum("replies"), interviews: sum("interviews"), ghosted: sum("ghosted") } };
}

export const family = (channel: string) => (/linkedin/i.test(channel) ? "LinkedIn" : /indeed/i.test(channel) ? "Indeed" : "Other");
export const chicagoToday = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(d);
const day = (s: string) => Date.parse(s + "T00:00:00Z") / 864e5;

export function todayStats(rows: Row[], today: string) {
  const conf = rows.filter((r) => r.submission_status === "confirmed");
  const t = { LinkedIn: 0, Indeed: 0, Other: 0 };
  for (const r of conf) if (r.date_submitted === today) t[family(r.channel) as keyof typeof t]++;
  return {
    confirmedTotal: conf.length,
    platformFlag: rows.filter((r) => r.submission_status === "platform_flag").length,
    incomplete: rows.filter((r) => r.submission_status === "incomplete").length,
    today: t,
    todayFlagged: rows.filter((r) => r.date_submitted === today && r.submission_status === "platform_flag").length,
    replied: conf.filter((r) => REPLIED.has(r.stage)).length,
    interviews: conf.filter((r) => INTERVIEW.has(r.stage)).length,
  };
}

/** Everything the skill says should be surfaced to the user, derived from the ledger alone. */
export function derive(rows: Row[], today: string): Flag[] {
  const out: Flag[] = [];
  const label = (r: Row) => `#${r.id} ${r.company}`;
  for (const r of rows) {
    if (!STATUSES.includes(r.submission_status)) out.push({ level: "error", id: r.id, text: `${label(r)}: invalid submission_status "${r.submission_status}"` });
    if (r.submission_status === "confirmed" && !r.evidence) out.push({ level: "error", id: r.id, text: `${label(r)}: confirmed without evidence (must not count)` });
  }
  const norm = (r: Row) => `${r.company}|${r.role}`.toLowerCase();
  const sent = rows.filter((r) => r.submission_status !== "incomplete");
  for (const r of sent) {
    const prev = sent.find((e) => e.id !== r.id && norm(e) === norm(r) && day(r.date_submitted) - day(e.date_submitted) > 0 && day(r.date_submitted) - day(e.date_submitted) <= 60);
    if (prev) out.push({ level: "warn", id: r.id, text: `${label(r)}: duplicate of #${prev.id} within 60 days` });
  }
  const t: Record<string, number> = {};
  for (const r of sent) if (r.date_submitted === today) t[family(r.channel)] = (t[family(r.channel)] ?? 0) + 1;
  for (const [f, cap] of Object.entries(CAPS)) if ((t[f] ?? 0) > cap) out.push({ level: "warn", text: `${f}: ${t[f]} submitted today, over the daily cap of ${cap}` });
  for (const r of rows) {
    if (r.submission_status === "incomplete") out.push({ level: "todo", id: r.id, text: `${label(r)}: incomplete. ${r.next_action || "Finish or drop it"}` });
    else if (r.submission_status === "platform_flag") out.push({ level: "todo", id: r.id, text: `${label(r)}: platform flag only. Needs employer confirmation before it counts` });
    else if (r.submission_status === "confirmed" && r.stage === "applied") {
      const age = day(today) - day(r.date_submitted);
      if (age >= 7 && age < 14) out.push({ level: "todo", id: r.id, text: `${label(r)}: day-7 follow-up due (draft only, send after approval)` });
      else if (age >= 14 && age < 21) out.push({ level: "todo", id: r.id, text: `${label(r)}: day-14 follow-up due (last one)` });
    }
    if (r.next_action && r.next_action_date && r.next_action_date <= today && r.submission_status === "confirmed" && !["rejected", "rejected_after_contact", "withdrawn", "ghosted", "offer"].includes(r.stage) && !/follow-up/i.test(r.next_action))
      out.push({ level: "todo", id: r.id, text: `${label(r)}: ${r.next_action} (due ${r.next_action_date})` });
  }
  const rank = { error: 0, warn: 1, todo: 2 } as const;
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
