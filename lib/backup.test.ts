import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupData } from "./backup";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jobpipe-backup-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("backupData", () => {
  it("writes flat per-file backups under data/.bak (rule 8)", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), "{}");
    const bakDir = backupData(dir);
    expect(bakDir).toContain(".bak");
    const entries = readdirSync(bakDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^jobs\.json\.bak-\d{8}-\d{6}-backup$/);
  });
  it("skips .bak itself (no recursion)", () => {
    mkdirSync(path.join(dir, "data/.bak/old"), { recursive: true });
    writeFileSync(path.join(dir, "data/.bak/old/keep.json"), "{}");
    writeFileSync(path.join(dir, "data/jobs.json"), "{}");
    const bakDir = backupData(dir);
    const backups = readdirSync(bakDir).filter((f) => f.includes(".bak-"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^jobs\.json\.bak-/);
  });
  it("backs up only listed files when files are given", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), "{}");
    writeFileSync(path.join(dir, "data/applications.json"), "{}");
    const bakDir = backupData(dir, ["jobs.json"], "apply-test");
    const entries = readdirSync(bakDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^jobs\.json\.bak-\d{8}-\d{6}-apply-test$/);
  });
  it("returns empty string when data/ does not exist", () => {
    expect(backupData(dir)).toBe("");
  });
});
