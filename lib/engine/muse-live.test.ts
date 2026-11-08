import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { processMuseLiveInboxOnce } from "./muse-live";
const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const now = Date.parse("2026-11-06T10:00:00Z");
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-live-")); dirs.push(base);
  mkdirSync(path.join(base, "data/inbox/muse-live"), { recursive: true }); return base;
}
const file = (base: string, rel: string) => path.join(base, "data", rel);
function submit(base: string, value: unknown, ms = now - 2000) {
  const p = file(base, "inbox/muse-live/job.json");
  writeFileSync(p, JSON.stringify(value)); utimesSync(p, new Date(ms), new Date(ms)); return p;
}
const processOnce = (base: string) => processMuseLiveInboxOnce(base, { nowMs: now });
const canonical = (base: string) => JSON.parse(readFileSync(file(base, "muse-live.json"), "utf8"));
describe("Engine live inbox durability and recovery", () => {
  it("respects stable window, then promotes and archives exact input", () => {
    const base = fixture(); const value = { jobId: "job", state: "working", detail: "fixture" };
    const p = submit(base, value, now - 1000);
    expect(processOnce(base)).toEqual([]); expect(existsSync(p)).toBe(true);
    expect(processMuseLiveInboxOnce(base, { nowMs: now + 1000 })).toEqual(["job"]);
    expect(canonical(base).live.job.state).toBe("working"); expect(existsSync(p)).toBe(false);
    const archived = readdirSync(file(base, "processed/muse-live"));
    expect(JSON.parse(readFileSync(file(base, `processed/muse-live/${archived[0]}`), "utf8"))).toEqual(value);
  });
  it("preserves input on save failure and succeeds on the next engine poll", () => {
    const base = fixture(); const p = submit(base, { jobId: "job", state: "working" });
    mkdirSync(file(base, "muse-live.json.tmp")); expect(() => processOnce(base)).toThrow();
    expect(existsSync(p)).toBe(true); rmSync(file(base, "muse-live.json.tmp"), { recursive: true });
    expect(processOnce(base)).toEqual(["job"]); expect(canonical(base).version).toBe(1);
  });
  it("replays safely after canonical save succeeds but archive fails", () => {
    const base = fixture(); const value = { jobId: "job", state: "working" }; const p = submit(base, value);
    writeFileSync(file(base, "processed"), "block archive");
    expect(() => processOnce(base)).toThrow(); expect(canonical(base).version).toBe(1); expect(existsSync(p)).toBe(true);
    rmSync(file(base, "processed")); expect(processOnce(base)).toEqual(["job"]);
    expect(canonical(base).version).toBe(1); expect(existsSync(p)).toBe(false);
  });
  it.each(["{", "null", "[]", '{"jobId":"../bad","state":"working"}', '{"jobId":"job","state":"unknown"}'])("quarantines invalid input %s", (raw) => {
    const base = fixture(); const p = submit(base, null); writeFileSync(p, raw); utimesSync(p, new Date(0), new Date(0));
    expect(processOnce(base)).toEqual([]); expect(existsSync(p)).toBe(false);
    const archive = readdirSync(file(base, "rejected/muse-live")); expect(archive).toHaveLength(2);
    expect(readFileSync(file(base, `rejected/muse-live/${archive.find((f) => !f.endsWith(".error.json"))}`), "utf8")).toBe(raw);
    expect(existsSync(file(base, "muse-live.json"))).toBe(false);
  });
  it.each(["{", "null", '{"version":1,"live":[]}'])("fails closed on corrupt canonical state %s", (raw) => {
    const base = fixture(); const p = submit(base, { jobId: "job", state: "working" });
    writeFileSync(file(base, "muse-live.json"), raw);
    expect(() => processOnce(base)).toThrow(); expect(existsSync(p)).toBe(true);
    expect(readFileSync(file(base, "muse-live.json"), "utf8")).toBe(raw);
  });
  it("retains done tombstones to prevent replay from resurrecting an older signal", () => {
    const base = fixture();
    submit(base, { jobId: "job", state: "working" }, now - 5000); processOnce(base);
    submit(base, { jobId: "job", state: "done" }, now - 3000); processOnce(base);
    const before = canonical(base); expect(before.live).toEqual({});
    submit(base, { jobId: "job", state: "working" }, now - 4000); processOnce(base);
    expect(canonical(base)).toEqual(before);
    submit(base, { jobId: "job", state: "waiting_user" }, now - 2000); processOnce(base);
    expect(canonical(base).live.job.state).toBe("waiting_user");
  });
  it("preserves unrelated live records and rejects invalid timestamps without touching state", () => {
    const base = fixture(); submit(base, { jobId: "a", state: "working" }); processOnce(base);
    submit(base, { jobId: "b", state: "working", createdAt: "invalid" }); processOnce(base);
    expect(Object.keys(canonical(base).live)).toEqual(["a"]);
  });
  it("quarantines contradictory signals at the same timestamp instead of silently accepting them", () => {
    const base = fixture(); const at = new Date(now - 5000).toISOString();
    submit(base, { jobId: "job", state: "working", createdAt: at }); processOnce(base);
    submit(base, { jobId: "job", state: "done", createdAt: at });
    expect(processOnce(base)).toEqual([]);
    expect(canonical(base).live.job.state).toBe("working");
    const files = readdirSync(file(base, "rejected/muse-live"));
    const diagnostic = files.find((p) => p.endsWith(".error.json"))!;
    expect(readFileSync(file(base, `rejected/muse-live/${diagnostic}`), "utf8")).toContain("E_LIVE_CONFLICT");
  });
});
