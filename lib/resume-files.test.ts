import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveResumeFile } from "./resume-files";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jobpipe-"));
  mkdirSync(path.join(dir, "data/resume-files"), { recursive: true });
  writeFileSync(path.join(dir, "data/resume-files", "v20251030-1.pdf"), "%PDF-1.4 fake");
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("resolveResumeFile", () => {
  it("resolves an existing pdf", () => {
    const r = resolveResumeFile(dir, "v20251030-1.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file).toBe(path.join(dir, "data/resume-files/v20251030-1.pdf"));
  });
  it("rejects path traversal", () => {
    expect(resolveResumeFile(dir, "../secret.pdf")).toEqual({ ok: false, reason: "invalid" });
    expect(resolveResumeFile(dir, "..\\secret.pdf")).toEqual({ ok: false, reason: "invalid" });
  });
  it("rejects absolute paths and subdirectories", () => {
    expect(resolveResumeFile(dir, "/etc/passwd.pdf").ok).toBe(false);
    expect(resolveResumeFile(dir, "sub/a.pdf").ok).toBe(false);
  });
  it("rejects non-pdf extensions", () => {
    expect(resolveResumeFile(dir, "a.txt")).toEqual({ ok: false, reason: "invalid" });
  });
  it("reports not-found for a missing pdf", () => {
    expect(resolveResumeFile(dir, "nope.pdf")).toEqual({ ok: false, reason: "not-found" });
  });
  it("rejects null and empty", () => {
    expect(resolveResumeFile(dir, null).ok).toBe(false);
    expect(resolveResumeFile(dir, "").ok).toBe(false);
  });
});
