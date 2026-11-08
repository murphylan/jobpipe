import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { processInboxOnce } from "./daemon";
import type { GenericChangeSet } from "./events";
import { applyQuirkLearned } from "./events3";
import { deriveDailyCounts, detectExternalModifications } from "./external";
import { writeState } from "./state";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-events3-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "data", "inbox"), { recursive: true });
  mkdirSync(path.join(base, "data", "runs"), { recursive: true });
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "changelog.json"), JSON.stringify({ entries: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), "id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes\n1,2026-10-31,Co,Role,,LinkedIn,,,,,confirmed,ev,applied,,,,,,\n");
  return base;
}

describe("engine stage 3 events, third batch (temp dirs only)", () => {
  it("QUIRK_LEARNED appends a quirk and rejects a duplicate id", () => {
    const base = fixture();
    const cs: GenericChangeSet = { taskId: "quirk-001", event: "QUIRK_LEARNED", createdAt: "2026-11-01T10:00:00Z", payload: { id: "q1", trigger: "on-call asked", action: "stop and ask" } };
    expect(applyQuirkLearned(base, cs).ok).toBe(true);
    const quirks = JSON.parse(readFileSync(path.join(base, "data", "quirks.json"), "utf-8"));
    expect(quirks.quirks).toHaveLength(1);
    expect(quirks.quirks[0].trigger).toBe("on-call asked");
    expect(applyQuirkLearned(base, cs).ok).toBe(false);
  });

  it("high-approval events stay pending and are not applied", () => {
    const base = fixture();
    const inboxFile = path.join(base, "data", "inbox", "prof-001.json");
    writeFileSync(inboxFile, JSON.stringify({ taskId: "prof-001", event: "PROFILE_CHANGED", createdAt: "2026-11-01T10:00:00Z", payload: { legalFirstName: "Alex" } }));
    const past = new Date(Date.now() - 10000);
    utimesSync(inboxFile, past, past);
    const first = processInboxOnce(base);
    expect(first[0].outcome).toBe("pending");
    expect(existsSync(inboxFile)).toBe(true);
    const receipt = JSON.parse(readFileSync(path.join(base, "data", "receipts", "prof-001.json"), "utf-8"));
    expect(receipt.status).toBe("pending-approval");
    const second = processInboxOnce(base);
    expect(second[0].outcome).toBe("pending");
  });

  it("external modification is detected against state.json", () => {
    const base = fixture();
    writeState(base, null);
    expect(detectExternalModifications(base).mismatches).toEqual([]);
    writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 2, updatedAt: "2026-11-01T00:00:00Z" }));
    const detected = detectExternalModifications(base);
    expect(detected.mismatches.some((m) => m.startsWith("jobs.json:"))).toBe(true);
  });

  it("daily derivation counts runs by Chicago date and ledger confirmed rows", () => {
    const base = fixture();
    writeFileSync(path.join(base, "data", "runs", "disc-001.json"), JSON.stringify({ taskId: "disc-001", event: "DISCOVERED", status: "committed", summary: "x", finishedAt: "2026-10-31T20:00:00Z" }));
    writeFileSync(path.join(base, "data", "runs", "scr-001.json"), JSON.stringify({ taskId: "scr-001", event: "SCREENED", status: "committed", summary: "x", finishedAt: "2026-11-01T02:00:00Z" }));
    const days = deriveDailyCounts(base);
    expect(days["2026-10-31"].discovery).toBe(1);
    expect(days["2026-10-31"].apply).toBe(1);
    expect(days["2026-10-31"].screening).toBe(1);
  });
});
