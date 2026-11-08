import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recalculateDaily, verifyDailyMatchesLedger } from "./daily";
import { deriveDaily } from "./external";
import { chicagoToday } from "../ledger";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const HEADER = "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes";
const TODAY = chicagoToday();
const YESTERDAY = chicagoToday(new Date(Date.now() - 86400000));

function fixture(ledgerRows: string): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-daily-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), `${HEADER}\n${ledgerRows}`);
  return base;
}

describe("engine daily recalculation (FR-10)", () => {
  it("counts committed business throughput by Chicago day, not backlog or runtime activity", () => {
    const base = fixture("");
    mkdirSync(path.join(base, "data/runs"));
    const add = (id: string, event: string, finishedAt: string, status = "committed") => writeFileSync(path.join(base, `data/runs/${id}.json`), JSON.stringify({ taskId: id, event, finishedAt, status }));
    add("discovery", "DISCOVERED", "2026-11-06T05:30:00Z"); // Chicago Nov 5 (UTC-6).
    add("review", "USER_DECIDED", "2026-11-06T07:00:00Z");
    add("runtime", "AGENT_ACTIVITY", "2026-11-06T07:00:00Z");
    add("rejected", "SCREENED", "2026-11-06T07:00:00Z", "rejected");
    writeFileSync(path.join(base, "data/jobs.json"), JSON.stringify({ jobs: Array.from({ length: 20 }, (_, i) => ({ id: String(i), status: "new" })) }));
    const result = recalculateDaily(base, "2026-11-06")!;
    expect(result.days["2026-11-06"]).toEqual({ discovery: 0, screening: 0, tailoring: 0, review: 1, apply: 0 });
    const before = readFileSync(path.join(base, "data/daily.json"), "utf8");
    recalculateDaily(base, "2026-11-06");
    expect(readFileSync(path.join(base, "data/daily.json"), "utf8")).toBe(before);
    expect(result.days["2026-11-05"]).toBeUndefined();
  });

  it("deriveDaily preserves historical values and corrupt state is never replaced", () => {
    const base = fixture("");
    const historical = { discovery: 9, screening: 8, tailoring: 7, review: 6, apply: 5 };
    writeFileSync(path.join(base, "data/daily.json"), JSON.stringify({ version: 1, updatedAt: "", days: { "2020-01-01": historical } }));
    expect(deriveDaily(base, new Date().toISOString()).ok).toBe(true);
    expect(JSON.parse(readFileSync(path.join(base, "data/daily.json"), "utf8")).days["2020-01-01"]).toEqual(historical);
    writeFileSync(path.join(base, "data/daily.json"), "{");
    expect(() => recalculateDaily(base)).toThrow();
    expect(readFileSync(path.join(base, "data/daily.json"), "utf8")).toBe("{");
  });
  it("recalculates today's apply count from the ledger", () => {
    const base = fixture(
      `1,${TODAY},Co A,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n` +
      `2,${TODAY},Co B,Role,,Indeed,,,,,confirmed,evidence,applied,,,,,,\n` +
      `3,${YESTERDAY},Co C,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`
    );
    const result = recalculateDaily(base, TODAY);
    expect(result).not.toBeNull();
    expect(result!.days[TODAY].apply).toBe(2);
    // Yesterday is not touched (frozen) - no entry created for it.
    expect(result!.days[YESTERDAY]).toBeUndefined();
  });

  it("freezes historical days when recalculating today", () => {
    const base = fixture(`1,${TODAY},Co A,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
    // Pre-populate with a historical entry.
    writeFileSync(
      path.join(base, "data", "daily.json"),
      JSON.stringify({
        version: 1,
        updatedAt: "2026-10-30T00:00:00Z",
        days: { [YESTERDAY]: { discovery: 1, screening: 2, tailoring: 0, review: 0, apply: 5 } },
      })
    );
    const result = recalculateDaily(base, TODAY);
    expect(result).not.toBeNull();
    // Historical day is unchanged.
    expect(result!.days[YESTERDAY]).toEqual({ discovery: 1, screening: 2, tailoring: 0, review: 0, apply: 5 });
    // Today is calculated.
    expect(result!.days[TODAY].apply).toBe(1);
  });

  it("counts only confirmed submissions", () => {
    const base = fixture(
      `1,${TODAY},Co A,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n` +
      `2,${TODAY},Co B,Role,,Indeed,,,,,platform_flag,,applied,,,,,,\n` +
      `3,${TODAY},Co C,Role,,LinkedIn,,,,,incomplete,,applied,,,,,,\n`
    );
    const result = recalculateDaily(base, TODAY);
    expect(result!.days[TODAY].apply).toBe(1);
  });

  it("verifyDailyMatchesLedger confirms consistency", () => {
    const base = fixture(`1,${TODAY},Co A,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
    recalculateDaily(base, TODAY);
    const v = verifyDailyMatchesLedger(base, TODAY);
    expect(v.ok).toBe(true);
    expect(v.dailyApply).toBe(1);
    expect(v.ledgerConfirmed).toBe(1);
  });

  it("verifyDailyMatchesLedger detects drift", () => {
    const base = fixture(`1,${TODAY},Co A,Role,,LinkedIn,,,,,confirmed,evidence,applied,,,,,,\n`);
    recalculateDaily(base, TODAY);
    // Manually corrupt daily.json.
    const dailyPath = path.join(base, "data", "daily.json");
    const daily = JSON.parse(readFileSync(dailyPath, "utf-8"));
    daily.days[TODAY].apply = 999;
    writeFileSync(dailyPath, JSON.stringify(daily));
    const v = verifyDailyMatchesLedger(base, TODAY);
    expect(v.ok).toBe(false);
    expect(v.dailyApply).toBe(999);
    expect(v.ledgerConfirmed).toBe(1);
  });
});
