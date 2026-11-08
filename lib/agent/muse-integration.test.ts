import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { buildExecutionContext } from "../engine/execution-context";
import { handleMuseHook } from "./muse-hooks";
import { runWithActivity } from "./run";
import { processInboxOnce } from "../engine/daemon";
import { queryActivityFeed } from "../engine/console";
import { assertMuseIntegration } from "./muse-preflight";
import { MUSE_EVENTS } from "./muse-hooks";
import { reportRuntime } from "./runtime-report";
import { spawnSync } from "node:child_process";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })));
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "jobpipe-muse-test-")); dirs.push(base);
  mkdirSync(path.join(base, "docs/skill"), { recursive: true }); mkdirSync(path.join(base, "data"));
  writeFileSync(path.join(base, "AGENTS.md"), "Only inbox writes; user approves applications");
  writeFileSync(path.join(base, "docs/skill/inbox-contract.md"), "Authoritative contract");
  return base;
}
function queued(base: string) { return readdirSync(path.join(base, "data/inbox")).filter(f => f.endsWith(".json")).sort().map(f => JSON.parse(readFileSync(path.join(base, "data/inbox", f), "utf8"))); }
it("requires actual approved runtime inventory rather than an installed flag", () => {
  const approved = { valid: true, active: true, record: { enabled: true }, capability_diagnostics: [], runtime_capabilities: MUSE_EVENTS.map(e => ({ candidate: { stable_id: `plugin:jobpipe-observer:hook:${e.toLowerCase()}` }, status: "trusted_enabled" })) };
  expect(() => assertMuseIntegration(approved)).not.toThrow();
  expect(() => assertMuseIntegration({ ...approved, runtime_capabilities: [] })).toThrow("not approved");
  expect(() => assertMuseIntegration({ ...approved, capability_diagnostics: ["store unavailable"] })).toThrow("inventory unavailable");
});
it("builds reproducible versioned context, excludes archived and unselected secrets, fails closed on corrupt data", () => {
  const base = fixture();
  const entry = (id: string, tags: string[], body: string, archived = false) => ({ id, title: id, body, tags, archived, createdAt: "now", updatedAt: "now" });
  writeFileSync(path.join(base, "data/knowledge.json"), JSON.stringify({ version: 3, updatedAt: "now", rereads: [], entries: [entry("method", ["agent-context"], "Use email registration; vault reference: company/account"), entry("old", ["agent-context"], "old", true), entry("secret", ["credential", "agent-context"], "DO_NOT_EXPORT"), entry("private", [], "PRIVATE"), entry("unsafe", ["agent-context"], "password=DO_NOT_EXPORT")] }));
  const bytes = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  const context = buildExecutionContext(base, "apply", "Apply after approval");
  expect(context.digest).toBe(buildExecutionContext(base, "apply", "Apply after approval").digest);
  expect(context.knowledgeVersion).toBe(3); expect(context.knowledge.map(k => k.id)).toEqual(["method", "unsafe"]);
  expect(JSON.stringify(context)).not.toMatch(/DO_NOT_EXPORT|PRIVATE/);
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(bytes);
  expect(() => buildExecutionContext(base, "apply", "Task", "missing")).toThrow("not found");
  writeFileSync(path.join(base, "data/knowledge.json"), "broken");
  expect(() => buildExecutionContext(base, "apply", "Task")).toThrow();
});
it("hook retries are idempotent even after Engine receipts, tools remain runtime observations", () => {
  const base = fixture(), contextFile = path.join(base, "context.json");
  writeFileSync(contextFile, JSON.stringify(buildExecutionContext(base, "apply", "Task")));
  const config = { base, runId: "run-test", activityId: "activity-test", stage: "apply", title: "Muse" };
  const input = { session_id: "session", tool_use_id: "tool", tool_input: { password: "SECRET" }, tool_response: "SECRET" };
  handleMuseHook("PreToolUse", input, config, contextFile);
  handleMuseHook("PreToolUse", input, config, contextFile);
  expect(queued(base)).toHaveLength(1);
  { const results = processInboxOnce(base, { nowMs: Date.now() + 2000 }); expect(results.every(r => r.outcome === "committed"), JSON.stringify(results)).toBe(true); }
  expect(queryActivityFeed(base, {}).running).toHaveLength(1);
  handleMuseHook("PreToolUse", input, config, contextFile);
  expect(queued(base)).toHaveLength(0);
  handleMuseHook("PostToolUse", input, config, contextFile);
  handleMuseHook("Stop", { session_id: "session" }, config, contextFile);
  expect(queued(base).map(e => e.payload.sequence)).toEqual([1, 2]);
  expect(queued(base).map(e => e.payload.status)).toEqual(["running", "waiting"]);
  expect(JSON.stringify(queued(base))).not.toContain("SECRET");
  { const results = processInboxOnce(base, { nowMs: Date.now() + 2000 }); expect(results.every(r => r.outcome === "committed"), JSON.stringify(results)).toBe(true); }
  expect(queryActivityFeed(base, {}).activities[0].status).toBe("waiting");
  expect(existsSync(path.join(base, "data/applications.json"))).toBe(false);
});
it("rejects missing identities, foreign context and tampered context before inbox writes", () => {
  const base = fixture(), contextFile = path.join(base, "context.json");
  const context = buildExecutionContext(base, "apply", "Task"); writeFileSync(contextFile, JSON.stringify(context));
  const config = { base, runId: "run-test", activityId: "activity-test", stage: "apply", title: "Muse" };
  expect(() => handleMuseHook("PreToolUse", { session_id: "s" }, config, contextFile)).toThrow("tool_use_id");
  expect(() => handleMuseHook("SessionStart", { session_id: "s" }, { ...config, base: base + "wrong" }, contextFile)).toThrow("mismatch");
  writeFileSync(contextFile, JSON.stringify({ ...context, task: "changed" }));
  expect(() => handleMuseHook("SessionStart", { session_id: "s" }, config, contextFile)).toThrow("digest");
  expect(existsSync(path.join(base, "data/inbox"))).toBe(false);
});
it("process liveness cannot overwrite an observed user waiting state", () => {
  const base = fixture();
  const config = { base, runId: "waiting-test", activityId: "waiting-activity", stage: "apply", title: "Muse" };
  reportRuntime(config, "start", "running", "started");
  reportRuntime(config, "stop", "waiting", "waiting for confirmation");
  reportRuntime(config, "wrapper-pulse-1", "running", "process alive");
  expect(queued(base).map(e => e.payload.status)).toEqual(["running", "waiting"]);
  reportRuntime(config, "next-turn", "running", "actual user prompt received");
  expect(queued(base).at(-1).payload.sequence).toBe(2);
});
it("native shim discovers its parent launch without inherited JobPipe environment", () => {
  const base = fixture(), contextFile = path.join(base, "context.json");
  writeFileSync(contextFile, JSON.stringify(buildExecutionContext(base, "apply", "Native shim")));
  mkdirSync(path.join(base, "data/inbox/.runtime"), { recursive: true });
  const marker = path.join(base, "data/inbox/.runtime", `muse-${process.pid}.json`);
  writeFileSync(marker, JSON.stringify({ base, contextFile, projectRoot: path.resolve("."), runId: "shim-run", activityId: "shim-activity", stage: "apply", title: "Shim" }));
  for (let i = 0; i < MUSE_EVENTS.length; i++) {
    const result = spawnSync(process.execPath, [path.resolve(`integrations/muse/jobpipe-observer/hooks/event-${i}.mjs`)], {
      encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" },
      input: JSON.stringify({ cwd: base, session_id: "native-test", tool_use_id: "test-tool", tool_response: "PRIVATE_OUTPUT" }),
    });
    expect(result.status, result.stderr).toBe(0);
  }
  expect(queued(base)).toHaveLength(7);
  expect(JSON.stringify(queued(base))).not.toContain("PRIVATE_OUTPUT");
});
it("real child hook and wrapper share sequencing; apply exit never fabricates business success", async () => {
  const base = fixture(), contextFile = path.join(base, "context.json");
  writeFileSync(contextFile, JSON.stringify(buildExecutionContext(base, "apply", "Task")));
  const hook = path.resolve("scripts/muse-hook.ts");
  const command = [process.execPath, "-e", `const {spawnSync}=require('node:child_process');const r=spawnSync(process.execPath,[${JSON.stringify(hook)},'PreToolUse'],{env:process.env,input:JSON.stringify({session_id:'test',tool_use_id:'tool-1'})});if(r.status!==0){console.error(String(r.stderr));process.exit(1);}`];
  const result = await runWithActivity({ base, stage: "apply", title: "Muse", command, env: { JOBPIPE_MUSE_CONTEXT_FILE: contextFile } });
  expect(result.code).toBe(0);
  const events = queued(base); expect(events.map(e => e.payload.sequence)).toEqual([0, 1, 2]);
  expect(events.at(-1).payload.status).toBe("waiting");
  { const results = processInboxOnce(base, { nowMs: Date.now() + 2000 }); expect(results.every(r => r.outcome === "committed"), JSON.stringify(results)).toBe(true); }
});
