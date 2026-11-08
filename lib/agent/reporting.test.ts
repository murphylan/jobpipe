import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { publishEvent } from "./publish";
import { runWithActivity } from "./run";
import { processInboxOnce } from "../engine/daemon";
import { queryActivityFeed } from "../engine/console";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() { const base = mkdtempSync(path.join(tmpdir(), "jobpipe-agent-report-")); dirs.push(base); mkdirSync(path.join(base, "data")); return base; }
function events(base: string) { return readdirSync(path.join(base, "data/inbox")).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(readFileSync(path.join(base, "data/inbox", f), "utf8"))); }
it("publishes UTC from machine time and only changes inbox, not business files", () => {
  const base = fixture(); writeFileSync(path.join(base, "data/jobs.json"), "original");
  const event = publishEvent(base, { event: "TARGET_SET", payload: { date: "2026-11-06", target: 1 } }, new Date("2026-11-05T20:50:00Z"));
  expect(event.createdAt).toBe("2026-11-05T20:50:00.000Z"); expect(readFileSync(path.join(base, "data/jobs.json"), "utf8")).toBe("original");
  expect(existsSync(path.join(base, "data/receipts"))).toBe(false);
});
it("normalizes explicit offsets and refuses Beijing clock mislabeled with Z instead of guessing", () => {
  const base = fixture(), now = new Date("2026-11-05T20:50:00Z");
  expect(publishEvent(base, { event: "TARGET_SET", createdAt: "2026-11-06T04:49:00+08:00", payload: {} }, now).createdAt).toBe("2026-11-05T20:49:00.000Z");
  expect(() => publishEvent(base, { event: "TARGET_SET", createdAt: "2026-11-06T04:49:00Z", payload: {} }, now)).toThrow("future");
  expect(() => publishEvent(base, { event: "APPLICATION_SUBMITTED", payload: { appliedAt: "2026-11-06T04:49:00Z" } }, now)).toThrow("future");
  expect(() => publishEvent(base, { event: "TARGET_SET", createdAt: "2026-11-05T20:49:00", payload: {} }, now)).toThrow("timezone");
});
it("keeps exact inbox retries immutable and rejects changed payloads or already receipted keys", () => {
  const base = fixture(); const input = { taskId: "one", event: "TARGET_SET", payload: { target: 1 } };
  const first = publishEvent(base, input); expect(publishEvent(base, input)).toEqual(first);
  expect(() => publishEvent(base, { ...input, payload: { target: 2 } })).toThrow("conflicts");
  mkdirSync(path.join(base, "data/receipts")); writeFileSync(path.join(base, "data/receipts/old.json"), "{}");
  expect(() => publishEvent(base, { ...input, taskId: "old" })).toThrow("Receipt");
});
it("a real process supplies ordered live progress, stops on exit and reaches Engine/Activity without fake business completion", async () => {
  const base = fixture(); const run = runWithActivity({ base, activityId: "real-process", stage: "screening", title: "Real test process", command: [process.execPath, "-e", "setTimeout(() => {}, 150)"], pulseMs: 20 });
  const result = await run; expect(result.code).toBe(0);
  const queued = events(base); expect(queued.length).toBeGreaterThan(2); expect(queued[0].payload.status).toBe("running"); expect(queued.at(-1).payload.status).toBe("done");
  expect(queued.map(e => e.payload.sequence)).toEqual(queued.map((_, i) => i));
  expect(queued.at(-1).evidence[0].text).toContain("process-exit");
  const count = queued.length; await new Promise(resolve => setTimeout(resolve, 60)); expect(events(base)).toHaveLength(count);
  const results = processInboxOnce(base, { nowMs: Date.now() + 2000 }); expect(results.every(r => r.outcome === "committed"), JSON.stringify(results)).toBe(true);
  const feed = queryActivityFeed(base, {}); expect(feed.activities[0].status).toBe("done"); expect(feed.running).toEqual([]);
  expect(existsSync(path.join(base, "data/jobs.json"))).toBe(false);
});
it("a live process running signal becomes visible before it finishes", async () => {
  const base = fixture(); const release = path.join(base, "release-test-process");
  const command = `const fs = require('node:fs'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(release)})) clearInterval(timer); }, 10);`;
  const promise = runWithActivity({ base, stage: "screening", title: "Active", command: [process.execPath, "-e", command], pulseMs: 50 });
  try {
    for (let i = 0; i < 200 && !existsSync(path.join(base, "data/inbox")); i++) await new Promise(resolve => setTimeout(resolve, 5));
    const result = processInboxOnce(base, { nowMs: Date.now() + 2000 }); expect(result[0].outcome).toBe("committed");
    expect(queryActivityFeed(base, {}).running).toHaveLength(1);
  } finally { writeFileSync(release, "done"); await promise; }
});
it("apply process exit without same-job business proof is waiting, never a submitted application", async () => {
  const base = fixture(); await runWithActivity({ base, stage: "apply", title: "No application proof", command: [process.execPath, "-e", ""], pulseMs: 1000 });
  expect(events(base).at(-1).payload.status).toBe("waiting"); expect(events(base).some(e => e.payload.status === "done")).toBe(false);
});
it("failure reports failed and stops the heartbeat", async () => {
  const base = fixture(); const result = await runWithActivity({ base, stage: "screening", title: "Failure", command: [process.execPath, "-e", "process.exit(2)"], pulseMs: 1000 });
  expect(result.code).toBe(2); expect(events(base).at(-1).payload.status).toBe("failed");
});
