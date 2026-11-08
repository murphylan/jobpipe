import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureBaseline, checkBaseline } from "./baseline";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-baseline-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), "id,date_submitted\n1,2026-10-31\n");
  return base;
}

describe("engine baseline (temp dirs only)", () => {
  it("unchanged files pass", () => {
    const base = fixture();
    const baseline = captureBaseline(base, ["jobs.json", "mirror/ledger.csv"]);
    expect(checkBaseline(baseline, base).ok).toBe(true);
  });

  it("version change is a mismatch", () => {
    const base = fixture();
    const baseline = captureBaseline(base, ["jobs.json"]);
    writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 2, updatedAt: "2026-10-31T00:00:00Z" }));
    const r = checkBaseline(baseline, base);
    expect(r.ok).toBe(false);
    expect(r.mismatches.some((m) => m.includes("version"))).toBe(true);
  });

  it("deleted file is a mismatch", () => {
    const base = fixture();
    const baseline = captureBaseline(base, ["mirror/ledger.csv"]);
    unlinkSync(path.join(base, "data", "mirror", "ledger.csv"));
    const r = checkBaseline(baseline, base);
    expect(r.ok).toBe(false);
    expect(r.mismatches.some((m) => m.includes("gone"))).toBe(true);
  });

  it("max ledger id change is a mismatch", () => {
    const base = fixture();
    const baseline = captureBaseline(base, ["mirror/ledger.csv"]);
    writeFileSync(path.join(base, "data", "mirror", "ledger.csv"), "id,date_submitted\n1,2026-10-31\n2,2026-10-31\n");
    const r = checkBaseline(baseline, base);
    expect(r.ok).toBe(false);
    expect(r.mismatches.some((m) => m.includes("max id"))).toBe(true);
  });
});
