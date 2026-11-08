import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as resumeGet } from "../app/api/resume-file/route";
import { GET as pipelineGet } from "../app/api/pipeline/route";

let testDir: string;

beforeEach(() => {
  // 每个测试用独立临时目录，绝不碰真实 data/
  testDir = mkdtempSync(path.join(tmpdir(), "jobpipe-test-"));
  mkdirSync(path.join(testDir, "data/resume-files"), { recursive: true });
  process.env.PIPELINE_DIR = testDir;
});

afterEach(() => {
  delete process.env.PIPELINE_DIR;
  rmSync(testDir, { recursive: true, force: true });
});

describe("resume-file route", () => {
  it("serves a pdf inline with the right headers", async () => {
    writeFileSync(path.join(testDir, "data/resume-files/t.pdf"), "%PDF-1.4 fake");
    const res = await resumeGet(new Request("http://x/api/resume-file?path=t.pdf"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(await res.text()).toBe("%PDF-1.4 fake");
  });
  it("serves as attachment with download=1", async () => {
    writeFileSync(path.join(testDir, "data/resume-files/t.pdf"), "%PDF-1.4 fake");
    const res = await resumeGet(new Request("http://x/api/resume-file?path=t.pdf&download=1"));
    expect(res.headers.get("Content-Disposition")).toContain("attachment");
  });
  it("400 on traversal", async () => {
    expect((await resumeGet(new Request("http://x/api/resume-file?path=../a.pdf"))).status).toBe(400);
  });
  it("404 on missing file", async () => {
    expect((await resumeGet(new Request("http://x/api/resume-file?path=nope.pdf"))).status).toBe(404);
  });
});

describe("pipeline route (extended)", () => {
  it("includes the new data keys (sample fallback when data/ is missing)", async () => {
    process.env.PIPELINE_DIR = path.join(tmpdir(), "jobpipe-nope");
    try {
      const res = await pipelineGet(new Request("http://x/api/pipeline"));
      expect(res.status).toBe(200);
      const body = await res.json();
      for (const k of ["jobs", "applications", "resumeVersions", "resumes", "profile", "quirks", "skill", "dailyTargets", "daily", "changelog", "skillDocs"]) {
        expect(body).toHaveProperty(k);
      }
      // Empty-vs-sample depends on the machine (data/sample/ may exist); emptiness is
      // covered hermetically in datafiles.test.ts. Here we only assert the shape.
      expect(Array.isArray(body.jobs.jobs)).toBe(true);
      expect(Array.isArray(body.skillDocs)).toBe(true);
      expect(body).toHaveProperty("version");
    } finally {
      delete process.env.PIPELINE_DIR;
    }
  });
});
