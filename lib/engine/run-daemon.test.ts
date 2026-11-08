import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { commitDataGit } from "./git";
import { acquireLock, lockPath, releaseLock } from "./lock";
import { readState, writeState } from "./state";

const temps: string[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

function fixture(): string {
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  vi.stubEnv("GIT_CONFIG_COUNT", "0");
  const base = mkdtempSync(path.join(tmpdir(), "engine-run-daemon-"));
  temps.push(base);
  mkdirSync(path.join(base, "data"), { recursive: true });
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 1, updatedAt: "2026-10-31T00:00:00Z" }));
  return base;
}

describe("engine run-daemon pieces (temp dirs only)", () => {
  it("second lock acquire fails while the first is held, then succeeds after release", () => {
    const base = fixture();
    expect(acquireLock(base)).toBe(true);
    expect(existsSync(lockPath(base))).toBe(true);
    expect(acquireLock(base)).toBe(false);
    releaseLock(base);
    expect(existsSync(lockPath(base))).toBe(false);
    expect(acquireLock(base)).toBe(true);
    releaseLock(base);
  });

  it("a stale lock (dead pid) is reclaimed", () => {
    const base = fixture();
    writeFileSync(lockPath(base), JSON.stringify({ pid: 999999, startedAt: "2026-10-31T00:00:00Z" }));
    expect(acquireLock(base)).toBe(true);
    releaseLock(base);
  });

  it("state round-trips with a baseline of the core files", () => {
    const base = fixture();
    const state = writeState(base, "target-001");
    expect(state.lastTaskId).toBe("target-001");
    expect(state.baseline.entries.some((e) => e.path === "jobs.json" && e.exists)).toBe(true);
    expect(readState(base)?.lastTaskId).toBe("target-001");
  });

  it("git commit fails gracefully outside a repo and succeeds inside one", () => {
    const base = fixture();
    const noRepo = commitDataGit(base, "task-1", ["jobs.json"]);
    expect(noRepo.ok).toBe(false);
    spawnSync("git", ["init"], { cwd: path.join(base, "data"), encoding: "utf-8" });
    spawnSync("git", ["-C", path.join(base, "data"), "add", "jobs.json"], { encoding: "utf-8" });
    spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "-C", path.join(base, "data"), "commit", "-m", "init"], { encoding: "utf-8" });
    writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 2, updatedAt: "2026-11-01T00:00:00Z" }));
    const ok = commitDataGit(base, "task-2", ["jobs.json"]);
    expect(ok.ok).toBe(true);
    const log = spawnSync("git", ["-C", path.join(base, "data"), "log", "--oneline"], { encoding: "utf-8" });
    expect(log.stdout).toContain("engine: task-2");
  });
});

it("release only removes the lock owned by this process and lease token", () => {
  const base = fixture();
  writeFileSync(lockPath(base), JSON.stringify({ pid: process.pid, token: "foreign" }));
  releaseLock(base); expect(existsSync(lockPath(base))).toBe(true);
  rmSync(lockPath(base)); expect(acquireLock(base)).toBe(true);
  writeFileSync(lockPath(base), JSON.stringify({ pid: process.pid, token: "replacement" }));
  releaseLock(base); expect(existsSync(lockPath(base))).toBe(true);
});

it("repeated lock acquisition closes every successful open descriptor", () => {
  const base = fixture(); const before = readdirSync("/dev/fd").length;
  for (let i = 0; i < 50; i++) { expect(acquireLock(base)).toBe(true); releaseLock(base); }
  expect(readdirSync("/dev/fd").length).toBeLessThanOrEqual(before + 1);
});

it("a real killed lock holder is reclaimed on the next engine start", () => {
  const base = fixture(); const module = new URL("./lock.ts", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `import { acquireLock } from ${JSON.stringify(module)}; if (!acquireLock(${JSON.stringify(base)})) throw new Error('lock failed'); process.kill(process.pid, 'SIGKILL');`], { encoding: "utf8" });
  expect(child.signal, child.stderr).toBe("SIGKILL"); expect(acquireLock(base)).toBe(true); releaseLock(base);
});
