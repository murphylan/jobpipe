import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadFullSnapshotData, readJsonFile, readJsonFileWithSource, readSkillDocs, TERMINAL_STAGES } from "./datafiles";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), "jobpipe-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const EMPTY = { version: 0, jobs: [] as unknown[] };

describe("readJsonFile", () => {
  it("reads data/<name>.json when present", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), JSON.stringify({ version: 1, jobs: [{ id: "a" }] }));
    expect(readJsonFile(dir, "jobs.json", EMPTY)).toEqual({ version: 1, jobs: [{ id: "a" }] });
  });
  it("does not substitute sample for missing real data", () => {
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/sample/jobs.json"), JSON.stringify({ version: 2, jobs: [] }));
    expect(readJsonFile(dir, "jobs.json", EMPTY)).toEqual(EMPTY);
  });
  it("prefers data/ over data/sample/", () => {
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), JSON.stringify({ version: 1, jobs: [] }));
    writeFileSync(path.join(dir, "data/sample/jobs.json"), JSON.stringify({ version: 2, jobs: [] }));
    expect(readJsonFile(dir, "jobs.json", EMPTY)).toEqual({ version: 1, jobs: [] });
  });
  it("returns the fallback when nothing exists", () => {
    expect(readJsonFile(dir, "jobs.json", EMPTY)).toEqual(EMPTY);
  });
  it("returns the fallback for corrupt JSON instead of throwing", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), "{corrupt");
    expect(readJsonFile(dir, "jobs.json", EMPTY)).toEqual(EMPTY);
  });
});

describe("readJsonFileWithSource", () => {
  it("marks source as 'real' when data/<name>.json exists", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), JSON.stringify({ version: 1, jobs: [] }));
    const r = readJsonFileWithSource(dir, "jobs.json", EMPTY);
    expect(r.source).toBe("real");
    expect(r.data).toEqual({ version: 1, jobs: [] });
  });
  it("marks source as missing when only sample exists", () => {
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/sample/jobs.json"), JSON.stringify({ version: 2, jobs: [] }));
    const r = readJsonFileWithSource(dir, "jobs.json", EMPTY);
    expect(r.source).toBe("missing");
    expect(r.data).toEqual(EMPTY);
  });
  it("marks source as 'missing' when nothing exists", () => {
    const r = readJsonFileWithSource(dir, "jobs.json", EMPTY);
    expect(r.source).toBe("missing");
    expect(r.data).toEqual(EMPTY);
  });
  it("marks source as 'corrupt' for invalid JSON", () => {
    mkdirSync(path.join(dir, "data"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), "{corrupt");
    const r = readJsonFileWithSource(dir, "jobs.json", EMPTY);
    expect(r.source).toBe("corrupt");
    expect(r.data).toEqual(EMPTY);
  });
  it("prefers real over sample", () => {
    mkdirSync(path.join(dir, "data/sample"), { recursive: true });
    writeFileSync(path.join(dir, "data/jobs.json"), JSON.stringify({ version: 1, jobs: [] }));
    writeFileSync(path.join(dir, "data/sample/jobs.json"), JSON.stringify({ version: 2, jobs: [] }));
    const r = readJsonFileWithSource(dir, "jobs.json", EMPTY);
    expect(r.source).toBe("real");
  });
});

describe("readSkillDocs", () => {  it("reads docs/skill/*.md sorted, extracting titles", () => {
    mkdirSync(path.join(dir, "docs/skill"), { recursive: true });
    writeFileSync(path.join(dir, "docs/skill/10-b.md"), "# Bee\n\nbody b");
    writeFileSync(path.join(dir, "docs/skill/00-a.md"), "# Ay\n\nbody a");
    const docs = readSkillDocs(dir);
    expect(docs.map((d) => d.id)).toEqual(["00-a", "10-b"]);
    expect(docs[0]).toMatchObject({ title: "Ay", path: "docs/skill/00-a.md" });
    expect(docs[0].body).toContain("body a");
  });
  it("falls back to the filename when there is no heading", () => {
    mkdirSync(path.join(dir, "docs/skill"), { recursive: true });
    writeFileSync(path.join(dir, "docs/skill/zz.md"), "no heading here");
    expect(readSkillDocs(dir)[0].title).toBe("zz");
  });
  it("returns [] when docs/skill is missing", () => {
    expect(readSkillDocs(dir)).toEqual([]);
  });
});

describe("TERMINAL_STAGES", () => {
  it("contains offer, rejected, rejected_after_contact, ghosted, withdrawn", () => {
    expect(TERMINAL_STAGES).toContain("offer");
    expect(TERMINAL_STAGES).toContain("rejected");
    expect(TERMINAL_STAGES).toContain("rejected_after_contact");
    expect(TERMINAL_STAGES).toContain("ghosted");
    expect(TERMINAL_STAGES).toContain("withdrawn");
  });
  it("does not contain active stages", () => {
    expect(TERMINAL_STAGES).not.toContain("applied");
    expect(TERMINAL_STAGES).not.toContain("replied");
    expect(TERMINAL_STAGES).not.toContain("screen");
    expect(TERMINAL_STAGES).not.toContain("interview");
  });
});

describe("loadFullSnapshotData resume fileExists", () => {
  it("marks fileExists true only when the pdf is on disk", () => {
    mkdirSync(path.join(dir, "data/resume-files"), { recursive: true });
    writeFileSync(path.join(dir, "data/resume-files/v1.pdf"), "%PDF-1.4 fake");
    writeFileSync(path.join(dir, "data/resume-versions.json"), JSON.stringify({
      version: 1,
      updatedAt: "x",
      versions: [
        { version: "v1", jobId: "a", file: "data/resume-files/v1.pdf", createdAt: "x", note: "" },
        { version: "v2", jobId: "a", file: "data/resume-files/missing.pdf", createdAt: "x", note: "" },
        { version: "v3", jobId: "a", file: null, createdAt: "x", note: "" },
      ],
      selected: {},
    }));
    const snap = loadFullSnapshotData(dir);
    expect(snap.resumeVersions.versions.map((v) => v.fileExists)).toEqual([true, false, false]);
  });
});
