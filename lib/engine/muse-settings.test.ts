import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { GET, POST } from "../../app/api/settings/muse/route";
import { processInboxOnce } from "./daemon";
import { readMuseSettings } from "./muse-settings";
import { museCommands } from "../muse-commands";
import { probeMuse, readMuseEnvironment } from "../muse-environment";
import { MUSE_EVENTS } from "../agent/muse-hooks";
import { spawnSync } from "node:child_process";
const dirs: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-settings-")); dirs.push(base); mkdirSync(path.join(base, "data"));
  vi.stubEnv("PIPELINE_DIR", base); vi.stubEnv("CONSOLE_TOKEN", "test-settings-token"); return base;
}
function request(body: unknown, token = "test-settings-token", origin = "http://localhost") {
  return new Request("http://localhost/api/settings/muse", { method: "POST", headers: { host: "localhost", origin, "x-console-token": token, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
it("queues settings and lets Engine alone commit, retains history and deduplicates retries", async () => {
  const base = fixture();
  const response = await POST(request({ projectRoot: base, museBinary: "/opt/muse", expectedVersion: 0 }));
  expect(response.status).toBe(202);
  const { taskId } = await response.json();
  expect(existsSync(path.join(base, "data/muse-settings.json"))).toBe(false);
  const eventFile = path.join(base, "data/inbox", `${taskId}.json`), bytes = readFileSync(eventFile, "utf8");
  expect(processInboxOnce(base, { nowMs: Date.now() + 2000 })[0].outcome).toBe("committed");
  expect(readMuseSettings(base)).toMatchObject({ version: 1, museBinary: "/opt/muse", history: [{ taskId }] });
  writeFileSync(eventFile, bytes);
  expect(processInboxOnce(base, { nowMs: Date.now() + 2000 })[0].outcome).toBe("duplicate");
  expect(readMuseSettings(base).history).toHaveLength(1);
  const stale = await POST(request({ projectRoot: base, museBinary: "/opt/muse-new", expectedVersion: 0 })); expect(stale.status).toBe(409);
  expect((await POST(request({ projectRoot: base, museBinary: "/opt/muse-new", expectedVersion: 1 }))).status).toBe(202);
  expect(processInboxOnce(base, { nowMs: Date.now() + 2000 })[0].outcome).toBe("committed");
  expect(readMuseSettings(base).history).toHaveLength(2);
});
it("Engine rejects a second queued update with a stale version", async () => {
  const base = fixture();
  for (const binary of ["/opt/muse-a", "/opt/muse-b"]) expect((await POST(request({ projectRoot: base, museBinary: binary, expectedVersion: 0 }))).status).toBe(202);
  const results = processInboxOnce(base, { nowMs: Date.now() + 2000 });
  expect(results.filter(r => r.outcome === "committed")).toHaveLength(1);
  expect(results.filter(r => r.outcome === "rejected")[0].summary).toContain("E_VERSION");
  expect(readMuseSettings(base).history).toHaveLength(1);
});
it("protects settings from foreign origins, missing tokens and project redirection", async () => {
  const base = fixture(), payload = { projectRoot: base, museBinary: "/opt/muse", expectedVersion: 0 };
  expect((await POST(request(payload, "wrong"))).status).toBe(403);
  expect((await POST(request(payload, "test-settings-token", "http://localhost:9999"))).status).toBe(403);
  expect((await POST(request({ ...payload, projectRoot: "/other/project" }))).status).toBe(400);
  expect((await POST(request({ ...payload, museBinary: "muse; dangerous" }))).status).toBe(400);
  expect((await GET(new Request("http://localhost/api/settings/muse", { headers: { host: "evil.example" } }))).status).toBe(403);
  expect(existsSync(path.join(base, "data/inbox"))).toBe(false);
});
it("fails closed for corrupt stored config, never replaces its original bytes", async () => {
  const base = fixture(), file = path.join(base, "data/muse-settings.json"); writeFileSync(file, "corrupt");
  expect((await GET(new Request("http://localhost/api/settings/muse", { headers: { host: "localhost" } }))).status).toBe(503);
  expect((await POST(request({ projectRoot: base, museBinary: "/opt/muse", expectedVersion: 0 }))).status).toBe(503);
  expect(readFileSync(file, "utf8")).toBe("corrupt");
});
it("reads signal evidence separately from configuration and does not write defaults", () => {
  const base = fixture();
  writeFileSync(path.join(base, "data/activity.json"), JSON.stringify({ activities: [{ createdAt: "2026-11-06T01:00:00Z", note: "Muse SessionStart；context" }] }));
  const state = readMuseEnvironment(base);
  expect(state.settings.version).toBe(0); expect(state.signals.context).toBe("2026-11-06T01:00:00Z"); expect(state.signals.tools).toBeNull();
  expect(readdirSync(path.join(base, "data"))).toEqual(["activity.json"]);
});
it("probes only fixed commands with committed configuration and checks both Skill and runtime approvals", async () => {
  const base = fixture(), settings = readMuseSettings(base);
  const inventory = { valid: true, active: true, record: { enabled: true, source: { path: path.join(base, "integrations/muse/jobpipe-observer") } }, capability_diagnostics: [], runtime_capabilities: MUSE_EVENTS.map(e => ({ candidate: { stable_id: `plugin:jobpipe-observer:hook:${e.toLowerCase()}` }, status: "trusted_enabled" })), plugin: { capabilities: { skills: [{ id: "jobpipe-start" }] } } };
  const runner = vi.fn(async (_bin: string, args: string[]) => args[0] === "--version" ? "Muse Code 1.4.14 (1.4.14-R7309.1)" : JSON.stringify(inventory));
  expect(await probeMuse(base, settings, runner)).toMatchObject({ hooksApproved: true, skillRegistered: true, problems: [] });
  expect(runner.mock.calls.map(c => c[1])).toEqual([["--version"], ["plugins", "inspect", "jobpipe-observer", "--json"]]);
  inventory.record.source.path = "/other/jobpipe/integrations/muse/jobpipe-observer";
  expect((await probeMuse(base, settings, runner)).skillRegistered).toBe(false);
  inventory.runtime_capabilities = [];
  expect((await probeMuse(base, settings, runner)).hooksApproved).toBe(false);
});
it("quotes shell metacharacters as literal paths in generated commands", () => {
  const commands = museCommands("/project/a'$(touch danger)", "/bin/muse'", "apply", "/task/file `cmd`.md");
  expect(commands.setup).toContain("'/bin/muse'\"'\"''");
  expect(commands.start).toContain("'/task/file `cmd`.md'");
  expect(commands.start).toContain("--stage 'apply'");
});
it("generated shell commands execute with literal paths, including quotes and command substitutions", () => {
  const base = fixture(), root = path.join(base, "project'$(touch SHOULD_NOT_EXIST)"), binary = path.join(base, "muse'bin");
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  const recorder = `#!/usr/bin/env node\nrequire('node:fs').appendFileSync(process.env.JOBPIPE_TEST_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\n`;
  writeFileSync(binary, recorder, { mode: 0o700 });
  writeFileSync(path.join(root, "scripts/muse-start.ts"), recorder.replace("#!/usr/bin/env node\n", ""));
  const log = path.join(base, "args.log"), taskFile = path.join(base, "task `touch SHOULD_NOT_EXIST`.md");
  const commands = museCommands(root, binary, "apply", taskFile);
  const env = { ...process.env, TMPDIR: base + "/", JOBPIPE_TEST_LOG: log };
  for (const command of [commands.setup, commands.start]) {
    const result = spawnSync("/bin/sh", ["-c", command], { cwd: base, env, encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
  }
  const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
  expect(calls[0]).toEqual(["plugins", "validate", `${root}/integrations/muse/jobpipe-observer`, "--json"]);
  expect(calls.at(-1)).toEqual(["--stage", "apply", "--task-file", taskFile, "--trust-workspace"]);
  expect(existsSync(path.join(base, "SHOULD_NOT_EXIST"))).toBe(false);
  expect(existsSync(path.join(root, "SHOULD_NOT_EXIST"))).toBe(false);
});
