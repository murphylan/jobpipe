import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { COLS, band, chicagoToday, derive, funnelBy, parseLedger, todayStats, type Row } from "./ledger";

// Synthetic data belongs to tests, never to a user's business data directory.
const SAMPLE = [COLS.join(","), ...Array.from({ length: 17 }, (_, i) => [
  String(i + 1), "2026-10-29", `Acme ${i + 1}`, "Engineer", "https://example.com/job", i % 2 ? "Indeed" : "LinkedIn",
  String(5 + i % 6), "fullstack", "fixture-v1", "contract", "confirmed", "fixture confirmation", i % 3 ? "applied" : "interview", "", "", "", "", "", "",
].join(","))].join("\n") + "\n";
const fixtureDir = mkdtempSync(path.join(tmpdir(), "jobpipe-ledger-fixture-"));
const fixtureFile = path.join(fixtureDir, "ledger.csv");
writeFileSync(fixtureFile, SAMPLE);
afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));
const row = (o: Partial<Row>): Row => ({ id: "1", date_submitted: "2026-10-29", company: "A", role: "R", channel: "Indeed", score: "8", submission_status: "confirmed", evidence: "email", stage: "applied", resume_version: "v2", role_family: "backend-java", next_action: "", next_action_date: "", ...o }) as Row;

describe("csv", () => {
  it("handles quotes, commas, CRLF, embedded newlines, BOM-free input", () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n"l1\nl2",z\r\n')).toEqual([["a", "b"], ["x, y", 'he said "hi"'], ["l1\nl2", "z"]]);
  });
  it("ignores blank lines", () => expect(parseCsv("a\n\n\nb\n")).toEqual([["a"], ["b"]]));
});

describe("ledger", () => {
  it("parses the skill's 19-column header", () => {
    const rows = parseLedger("\uFEFF" + SAMPLE);
    expect(rows.length).toBe(17);
    expect(rows[0].company).toContain("Acme");
  });
  it("band() matches funnel.py", () => {
    expect([band("9"), band("8.9"), band("7"), band("6.9"), band("5"), band("4.9"), band("自投"), band("")]).toEqual(["9-10", "7-8.9", "7-8.9", "5-6.9", "5-6.9", "<5", "self/none", "self/none"]);
  });
  it("funnel equals scripts/funnel.py for every grouping (independent oracle)", () => {
    const py = spawnSync("python3", ["--version"]);
    if (py.status !== 0) return;
    const rows = parseLedger(SAMPLE);
    for (const by of ["score_band", "channel", "resume_version", "role_family"] as const) {
      const out = spawnSync("python3", ["scripts/funnel.py", fixtureFile, "--by", by], { encoding: "utf-8" }).stdout;
      const expected = out.trim().split("\n").slice(1).map((l) => { const m = l.match(/^(.+?)\s+(\d+)\s+(\d+)\s+\d+%\s+(\d+)\s+(\d+)$/)!; return [m[1], +m[2], +m[3], +m[4], +m[5]]; });
      const f = funnelBy(rows, by);
      expect([...f.groups.map((g) => [g.key, g.apps, g.replies, g.interviews, g.ghosted]), ["TOTAL", f.total.apps, f.total.replies, f.total.interviews, f.total.ghosted]]).toEqual(expected);
    }
  });
  it("counting discipline: total counts confirmed only", () => {
    const rows = [row({}), row({ id: "2", submission_status: "platform_flag", evidence: "" }), row({ id: "3", submission_status: "incomplete", evidence: "" })];
    const s = todayStats(rows, "2026-10-29");
    expect(s.confirmedTotal).toBe(1);
    expect(s.platformFlag).toBe(1);
    expect(s.incomplete).toBe(1);
  });
  it("today counts per platform, confirmed only", () => {
    const rows = [row({ channel: "LinkedIn Easy Apply" }), row({ id: "2", channel: "Indeed" }), row({ id: "3", channel: "Indeed", submission_status: "platform_flag", evidence: "" }), row({ id: "4", date_submitted: "2026-10-28" })];
    expect(todayStats(rows, "2026-10-29").today).toEqual({ LinkedIn: 1, Indeed: 1, Other: 0 });
  });
  it("flags confirmed rows without evidence as errors", () => {
    const f = derive([row({ id: "9", evidence: "" })], "2026-10-29");
    expect(f.some((x) => x.level === "error" && x.text.includes("without evidence"))).toBe(true);
  });
  it("flags a 60-day duplicate company+role", () => {
    const f = derive([row({ id: "1", date_submitted: "2026-09-20" }), row({ id: "2", date_submitted: "2026-10-29" })], "2026-10-29");
    expect(f.some((x) => x.text.includes("duplicate"))).toBe(true);
  });
  it("flags exceeding the daily cap (LinkedIn 15)", () => {
    const rows = Array.from({ length: 16 }, (_, i) => row({ id: String(i), company: `C${i}`, channel: "LinkedIn Easy Apply" }));
    expect(derive(rows, "2026-10-29").some((x) => x.text.includes("daily cap"))).toBe(true);
  });
  it("follow-ups at day 7 and day 14 only, for confirmed + applied", () => {
    const f = (days: number) => derive([row({ date_submitted: new Date(Date.UTC(2026, 9, 29) - days * 864e5).toISOString().slice(0, 10) })], "2026-10-29").filter((x) => x.text.includes("follow-up")).length;
    expect([f(6), f(7), f(13), f(14), f(20), f(21)]).toEqual([0, 1, 1, 1, 1, 0]);
  });
  it("today is computed in America/Chicago", () => {
    expect(chicagoToday(new Date("2026-10-30T03:30:00Z"))).toBe("2026-10-29");
  });
});
