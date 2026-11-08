import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { GET as pipeline } from "../app/api/pipeline/route";
import { GET as live } from "../app/api/muse-live/route";
import { dataRoot } from "./data-root";
import { loadFullSnapshotData } from "./datafiles";
const previous = process.env.PIPELINE_DIR;
const dirs: string[] = [];
afterEach(() => { if (previous === undefined) delete process.env.PIPELINE_DIR; else process.env.PIPELINE_DIR = previous; dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
it("pipeline and live API use the same configured project root and report missing real fields", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-root-")); dirs.push(base); process.env.PIPELINE_DIR = base;
  mkdirSync(path.join(base, "data/sample"), { recursive: true });
  writeFileSync(path.join(base, "data/muse-live.json"), JSON.stringify({ version: 1, updatedAt: "2026-11-06T00:00:00Z", live: {} }));
  writeFileSync(path.join(base, "data/sample/jobs.json"), JSON.stringify({ version: 1, updatedAt: "", jobs: [{ id: "fake" }] }));
  expect(dataRoot()).toBe(base);
  const snapshot = await (await pipeline(new Request("http://localhost/api/pipeline"))).json();
  expect(snapshot.source).toBe("missing"); expect(snapshot.jobsSource).toBe("missing"); expect(snapshot.jobs.jobs).toEqual([]);
  expect(snapshot.sources["muse-live.json"]).toBe("real"); expect(snapshot.dir).toBe(path.join(base, "data/mirror"));
  expect((await (await live()).json()).version).toBe(1);
});
it("malformed snapshot contracts report corrupt rather than crashing or mixing sample", () => {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-root-")); dirs.push(base); mkdirSync(path.join(base, "data"));
  writeFileSync(path.join(base, "data/resume-versions.json"), JSON.stringify({ version: 1, updatedAt: "", selected: {}, versions: [null] }));
  const snapshot = loadFullSnapshotData(base);
  expect(snapshot.sources["resume-versions.json"]).toBe("corrupt"); expect(snapshot.resumeVersions.versions).toEqual([]);
});
