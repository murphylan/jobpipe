import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET as decisionsGet, POST as decisionsPost } from "../app/api/decisions/route";
import { GET as engineGet } from "../app/api/engine/route";
import { GET as runGet } from "../app/api/runs/[id]/route";
import { GET as runsGet } from "../app/api/runs/route";
import { writeReceipt } from "./engine/receipt.ts";

let testDir: string;

beforeEach(() => {
  testDir = mkdtempSync(path.join(tmpdir(), "jobpipe-console-routes-"));
  mkdirSync(path.join(testDir, "data", "runs"), { recursive: true });
  mkdirSync(path.join(testDir, "data", "receipts"), { recursive: true });
  process.env.PIPELINE_DIR = testDir;
  // FR-21: tests use a fixed console token.
  process.env.CONSOLE_TOKEN = "test-token-123";
});

afterEach(() => {
  delete process.env.PIPELINE_DIR;
  delete process.env.CONSOLE_TOKEN;
  rmSync(testDir, { recursive: true, force: true });
});

function writeRun(taskId: string, status: string, finishedAt: string): void {
  writeFileSync(
    path.join(testDir, "data", "runs", `${taskId}.json`),
    JSON.stringify({ taskId, event: "TARGET_SET", status, summary: status, finishedAt }),
    "utf-8",
  );
}

function postDecision(body: unknown): Promise<Response> {
  return decisionsPost(
    new Request("http://localhost/api/decisions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // FR-21: Host/Origin/Token required. Note: `new Request` does not
        // auto-set Host from URL, so we set it explicitly.
        "Host": "localhost",
        "Origin": "http://localhost",
        "X-Console-Token": "test-token-123",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("console api routes (temp dirs only)", () => {
  it("engine status reports a missing heartbeat on an empty dir", async () => {
    const res = await engineGet();
    expect(res.status).toBe(200);
    const body = await res.json() as { heartbeat: { status: string }; today: string };
    expect(body.heartbeat.status).toBe("missing");
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("runs list is newest first and paginates at 15", async () => {
    for (let i = 1; i <= 16; i++) {
      writeRun(`t-${String(i).padStart(2, "0")}`, "committed", `2026-11-01T${String(i).padStart(2, "0")}:00:00Z`);
    }
    const page1 = await (await runsGet(new Request("http://x/api/runs"))).json() as { runs: { taskId: string }[]; total: number };
    expect(page1.total).toBe(16);
    expect(page1.runs).toHaveLength(15);
    expect(page1.runs[0].taskId).toBe("t-16");
    const page2 = await (await runsGet(new Request("http://x/api/runs?page=2"))).json() as { runs: { taskId: string }[] };
    expect(page2.runs).toHaveLength(1);
    expect(page2.runs[0].taskId).toBe("t-01");
  });

  it("single run: 400 on traversal, 404 on unknown, 200 with receipt", async () => {
    writeRun("r-001", "committed", "2026-11-01T01:00:00Z");
    writeReceipt(testDir, { taskId: "r-001", event: "TARGET_SET", status: "committed", createdAt: "2026-11-01T01:00:00Z", summary: "done" });
    expect((await runGet(new Request("http://x/api/runs/x"), { params: Promise.resolve({ id: "../evil" }) })).status).toBe(400);
    expect((await runGet(new Request("http://x/api/runs/x"), { params: Promise.resolve({ id: "ghost" }) })).status).toBe(404);
    const ok = await runGet(new Request("http://x/api/runs/x"), { params: Promise.resolve({ id: "r-001" }) });
    expect(ok.status).toBe(200);
    const body = await ok.json() as { run: { taskId: string }; receiptMd: string };
    expect(body.run.taskId).toBe("r-001");
    expect(body.receiptMd).toContain("# Receipt r-001");
  });

  it("decisions: pending list, quote guard, success writes only the decision file", async () => {
    writeReceipt(testDir, { taskId: "p-001", event: "PROFILE_CHANGED", status: "pending-approval", createdAt: "2026-11-01T01:00:00Z", summary: "held" });
    const list = await (await decisionsGet()).json() as { pending: { taskId: string }[] };
    expect(list.pending.map((r) => r.taskId)).toEqual(["p-001"]);
    expect((await postDecision({ taskId: "p-001", approved: true, quote: "" })).status).toBe(400);
    expect((await postDecision({ taskId: "ghost", approved: true, quote: "yes" })).status).toBe(404);
    const ok = await postDecision({ taskId: "p-001", approved: true, quote: "yes, change it" });
    expect(ok.status).toBe(201);
    expect(existsSync(path.join(testDir, "data", "inbox", "decisions", "p-001.json"))).toBe(true);
    expect((await postDecision({ taskId: "p-001", approved: false, quote: "" })).status).toBe(409);
  });
});
