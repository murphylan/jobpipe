import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { initializeWorkspace } from "./initialize";
import { validateDataDir } from "./validate";
const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); vi.unstubAllEnvs(); });
function fixture() { const root = mkdtempSync(path.join(tmpdir(), "jobpipe-init-")); roots.push(root); return root; }
it("creates valid empty records without invented personal facts or business history", () => {
  const root = fixture();
  const result = initializeWorkspace(root);
  expect(result.created).toContain("mirror/ledger.csv");
  expect(validateDataDir(root).errors).toEqual([]);
  for (const [file, key] of [["jobs.json", "jobs"], ["applications.json", "applications"], ["activity.json", "activities"], ["plans.json", "plans"], ["attempts.json", "attempts"]]) expect(JSON.parse(readFileSync(path.join(root, "data", file), "utf8"))[key]).toEqual([]);
  expect(Object.keys(JSON.parse(readFileSync(path.join(root, "data/profile.json"), "utf8")))).toEqual(["version", "updatedAt"]);
  expect(existsSync(path.join(root, "data/.git"))).toBe(true);
  expect(existsSync(path.join(root, "data/.engine.lock"))).toBe(false);
});
it("refuses a second initialization without changing existing files", () => {
  const root = fixture(); initializeWorkspace(root);
  const before = readFileSync(path.join(root, "data/jobs.json"), "utf8");
  expect(() => initializeWorkspace(root)).toThrow("not empty");
  expect(readFileSync(path.join(root, "data/jobs.json"), "utf8")).toBe(before);
});
it("refuses nonempty workspaces and respects a running Engine", () => {
  const root = fixture(); mkdirSync(path.join(root, "data"));
  writeFileSync(path.join(root, "data/keep.txt"), "do not overwrite");
  expect(() => initializeWorkspace(root)).toThrow("not empty");
  expect(readdirSync(path.join(root, "data"))).toEqual(["keep.txt"]);
  writeFileSync(path.join(root, "data/.engine.lock"), JSON.stringify({ pid: process.pid, token: "foreign-owner" }));
  expect(() => initializeWorkspace(root)).toThrow("engine already running");
  expect(existsSync(path.join(root, "data/.engine.lock"))).toBe(true);
});
