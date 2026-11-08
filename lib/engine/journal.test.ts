import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginJournal, commitJournal, restoreJournal } from "./journal";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-journal-"));
  temps.push(base);
  mkdirSync(path.join(base, "data"), { recursive: true });
  writeFileSync(path.join(base, "data", "jobs.json"), "original");
  return base;
}

describe("engine journal (temp dirs only)", () => {
  it("restore returns prior content and removes a file that did not exist before", () => {
    const base = fixture();
    beginJournal(base, "task-1", ["jobs.json", "newfile.json"]);
    writeFileSync(path.join(base, "data", "jobs.json"), "changed");
    writeFileSync(path.join(base, "data", "newfile.json"), "new");
    const restored = restoreJournal(base, "task-1");
    expect(restored).toContain("jobs.json");
    expect(readFileSync(path.join(base, "data", "jobs.json"), "utf-8")).toBe("original");
    expect(existsSync(path.join(base, "data", "newfile.json"))).toBe(false);
    expect(existsSync(path.join(base, "data", ".journal", "task-1.json"))).toBe(false);
  });

  it("begin twice throws", () => {
    const base = fixture();
    beginJournal(base, "task-1", ["jobs.json"]);
    expect(() => beginJournal(base, "task-1", ["jobs.json"])).toThrow();
  });

  it("commit deletes the journal without restoring", () => {
    const base = fixture();
    beginJournal(base, "task-1", ["jobs.json"]);
    writeFileSync(path.join(base, "data", "jobs.json"), "changed");
    commitJournal(base, "task-1");
    expect(readFileSync(path.join(base, "data", "jobs.json"), "utf-8")).toBe("changed");
    expect(existsSync(path.join(base, "data", ".journal", "task-1.json"))).toBe(false);
  });
});
