import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { checkConsoleOrigin, getConsoleToken } from "./console-protection";
import { GET as tokenGet } from "../app/api/console-token/route";
import { POST as decisionPost } from "../app/api/decisions/route";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })); });
it.each([
  ["http://localhost:5173", "localhost:5173", "http://localhost:5173", true],
  ["http://127.0.0.1:5173", "127.0.0.1:5173", "http://127.0.0.1:5173", true],
  ["http://[::1]:5173", "[::1]:5173", "http://[::1]:5173", true],
  ["http://localhost:5173", "localhost:5173", "http://localhost:3000", false],
  ["http://localhost:5173", "localhost:5173", "http://127.0.0.1:5173", false],
  ["http://localhost:5173", "localhost:5173", "https://localhost:5173", false],
  ["http://localhost:5173", "localhost:5173", "http://evil.invalid", false],
  ["http://localhost:5173", "localhost:5173", "null", false],
  ["http://localhost:5173", "evil.invalid", "http://localhost:5173", false],
  ["http://localhost:5173", "localhost:3000", "http://localhost:5173", false],
])("exact local origin: %s %s %s => %s", (url, host, origin, accepted) => {
  expect(checkConsoleOrigin(new Request(url, { headers: { host, origin } })).ok).toBe(accepted);
});
it("token file is private, reused and never silently replaced if empty/corrupt", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-console-token-")); dirs.push(base); vi.stubEnv("CONSOLE_TOKEN", ""); vi.stubEnv("PIPELINE_DIR", base);
  const token = getConsoleToken(base); const file = path.join(base, "data/.console-token"); expect(getConsoleToken(base)).toBe(token); expect(statSync(file).mode & 0o777).toBe(0o600);
  writeFileSync(file, ""); expect(() => getConsoleToken(base)).toThrow("empty");
  const res = await tokenGet(new Request("http://localhost/api/console-token", { headers: { host: "localhost" } })); expect(res.status).toBe(503); expect(readFileSync(file, "utf8")).toBe("");
});
it("approval and token APIs both reject a different local port before touching a token", async () => {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-console-token-")); dirs.push(base); vi.stubEnv("PIPELINE_DIR", base);
  const headers = { host: "[::1]:5173", origin: "http://[::1]:3000", "x-console-token": "fake" };
  expect((await tokenGet(new Request("http://[::1]:5173/api/console-token", { headers }))).status).toBe(403);
  expect((await decisionPost(new Request("http://[::1]:5173/api/decisions", { method: "POST", headers, body: "{}" }))).status).toBe(403);
});
