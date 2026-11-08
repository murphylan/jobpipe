import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const fixture = () => { const dir = mkdtempSync(path.join(tmpdir(), "engine-cli-")); dirs.push(dir); mkdirSync(path.join(dir, "data")); return dir; };
const cli = (...args: string[]) => spawnSync(process.execPath, ["scripts/engine.ts", ...args], { encoding: "utf8", timeout: 10000 });
it("accepts package-manager separators for read-only commands", () => {
  const base = fixture();
  const direct = cli("heartbeat", base);
  const forwarded = cli("--", "heartbeat", base);
  expect(direct.status, direct.stderr).toBe(0);
  expect(forwarded.status, forwarded.stderr).toBe(0);
  expect(JSON.parse(forwarded.stdout)).toEqual(JSON.parse(direct.stdout));
});
it("reports an existing daemon without a stack trace or changing its lock", () => {
  const base = fixture();
  const lock = path.join(base, "data/.engine.lock");
  const content = JSON.stringify({ pid: process.pid, token: "fixture-owner" });
  writeFileSync(lock, content);
  const result = cli("--", "daemon", "--base", base);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(`PID ${process.pid}`);
  expect(result.stderr).toContain("No second instance was started");
  expect(result.stderr).not.toContain("at runDaemonLoop");
  expect(readFileSync(lock, "utf8")).toBe(content);
});
