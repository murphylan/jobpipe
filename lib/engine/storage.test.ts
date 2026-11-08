import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { atomicCreateFileSync, atomicWriteFileSync } from "./storage";
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() { const dir = mkdtempSync(path.join(tmpdir(), "jobpipe-storage-")); dirs.push(dir); return dir; }
it("replaces a complete document and leaves no temp artifact", () => {
  const dir = fixture(), file = path.join(dir, "doc.json");
  atomicWriteFileSync(file, '{"old":true}');
  atomicWriteFileSync(file, '{"new":true}');
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ new: true });
  expect(readdirSync(dir)).toEqual(["doc.json"]);
});
it("failed rename leaves the destination untouched and removes temp files", () => {
  const dir = fixture(), file = path.join(dir, "destination"); mkdirSync(file);
  expect(() => atomicWriteFileSync(file, "replacement")).toThrow();
  expect(existsSync(file)).toBe(true);
  expect(readdirSync(dir)).toEqual(["destination"]);
});
it("publishes inbox messages without replacing the first complete submission", () => {
  const dir = fixture(), file = path.join(dir, "decision.json");
  expect(atomicCreateFileSync(file, "first")).toBe(true);
  expect(atomicCreateFileSync(file, "second")).toBe(false);
  expect(readFileSync(file, "utf8")).toBe("first");
  expect(readdirSync(dir)).toEqual(["decision.json"]);
});
