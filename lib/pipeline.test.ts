import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSnapshot } from "./pipeline";

const LEDGER = `id,date_submitted,company,role,req_url,channel,score,role_family,resume_version,employment_type,submission_status,evidence,stage,last_contact_date,recruiter,next_action,next_action_date,jd_snapshot_path,notes
1,2026-10-30,Acme,Backend,,Indeed,8,backend-java,v1,remote,confirmed,email,applied,,,,,,
`;

const DAILY = {
  version: 1,
  updatedAt: "2026-10-30T00:00:00Z",
  days: { "2026-10-30": { discovery: 3, screening: 5, tailoring: 4, review: 2, apply: 19 } },
};

const NOON_1030 = new Date("2026-10-30T12:00:00Z"); // 07:00 America/Chicago -> 2026-10-30

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jobpipe-"));
  process.env.PIPELINE_DIR = path.join(dir, "nope"); // steer away from real pipeline dirs
});
afterEach(() => {
  delete process.env.PIPELINE_DIR;
  rmSync(dir, { recursive: true, force: true });
});

function writeMirror(opts: { ledger?: string; daily?: unknown } = {}) {
  mkdirSync(path.join(dir, "data/mirror"), { recursive: true });
  writeFileSync(path.join(dir, "data/mirror/ledger.csv"), opts.ledger ?? LEDGER);
  if (opts.daily !== undefined)
    writeFileSync(path.join(dir, "data/daily.json"), typeof opts.daily === "string" ? opts.daily : JSON.stringify(opts.daily));
}

describe("loadSnapshot mirror mode", () => {
  it("prefers data/mirror/ledger.csv and reads stages from data/daily.json", () => {
    writeMirror({ daily: DAILY });
    const s = loadSnapshot(NOON_1030, dir);
    expect(s.source).toBe("live");
    expect(s.stages).toEqual({ discovery: 3, screening: 5, tailoring: 4, review: 2, apply: 19 });
    expect(s.ledger).toHaveLength(1);
    expect(s.ledger[0].company).toBe("Acme");
    expect(s.dir).toBe(path.join(dir, "data/mirror"));
  });

  it("yields zero stages when daily.json has no entry for today", () => {
    writeMirror({ daily: { version: 1, updatedAt: "x", days: {} } });
    expect(loadSnapshot(NOON_1030, dir).stages).toEqual({ discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 });
  });

  it("survives a corrupt daily.json without throwing", () => {
    writeMirror({ daily: "{corrupt" });
    const s = loadSnapshot(NOON_1030, dir);
    expect(s.source).toBe("live");
    expect(s.stages).toEqual({ discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 });
  });

  it("works when daily.json is absent", () => {
    writeMirror({});
    expect(loadSnapshot(NOON_1030, dir).stages).toEqual({ discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 });
  });

  it("reports missing real ledger without consuming sample", () => {
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/sample/ledger.csv"), LEDGER);
    const s = loadSnapshot(NOON_1030, dir);
    expect(s.source).toBe("missing");
    expect(s.ledger).toHaveLength(0);
  });

  it("version fingerprint changes when a data json is added", () => {
    writeMirror({ daily: DAILY });
    const v1 = loadSnapshot(NOON_1030, dir).version;
    writeFileSync(path.join(dir, "data/jobs.json"), JSON.stringify({ version: 1, jobs: [] }));
    const v2 = loadSnapshot(NOON_1030, dir).version;
    expect(v2).not.toBe(v1);
  });
  it("version fingerprint changes when a resume pdf is added", () => {
    writeMirror({ daily: DAILY });
    const v1 = loadSnapshot(NOON_1030, dir).version;
    mkdirSync(path.join(dir, "data/resume-files"), { recursive: true });
    writeFileSync(path.join(dir, "data/resume-files/v20261031-base.pdf"), "%PDF-1.4 fake");
    const v2 = loadSnapshot(NOON_1030, dir).version;
    expect(v2).not.toBe(v1);
  });
  it("version fingerprint changes when a sample file is added", () => {
    writeMirror({ daily: DAILY });
    const v1 = loadSnapshot(NOON_1030, dir).version;
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/sample/notes.txt"), "hello");
    const v2 = loadSnapshot(NOON_1030, dir).version;
    expect(v2).not.toBe(v1);
  });
});
