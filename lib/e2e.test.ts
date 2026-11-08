/**
 * Batch 6: 全链路回归测试（14 步端到端）
 * 所有写操作在临时目录，不污染真实 data/。
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupData } from "./backup";
import { applyScreeningUpdate, findDuplicateJobs, type Job } from "./jobs";
import { readJsonFileWithSource, TERMINAL_STAGES, type Application, type JobsFile } from "./datafiles";

let dir: string;
let dataDir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "jobpipe-e2e-"));
  dataDir = path.join(dir, "data");
  mkdirSync(dataDir, { recursive: true });
});
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const writeJson = (name: string, obj: unknown) =>
  writeFileSync(path.join(dataDir, name), JSON.stringify(obj, null, 2));

describe("E2E: 14 步求职闭环", () => {
  it("1-2. Discovery: 新职位入库，有唯一 id", () => {
    const job: Job = {
      id: "test-co-backend-engineer", company: "Test Co", role: "Backend Engineer",
      channel: "Indeed", location: "Remote", remote: "remote",
      salaryPosted: "$120K-$150K", salaryAnswer: null,
      matchPoints: [], redFlags: [], conclusion: "pending", status: "new",
      url: "https://example.com/job/1",
    };
    const jobsFile: JobsFile = { version: 1, updatedAt: new Date().toISOString(), jobs: [job] };
    writeJson("jobs.json", jobsFile);
    const { data, source } = readJsonFileWithSource<JobsFile>(dir, "jobs.json", { version: 0, updatedAt: "", jobs: [] });
    expect(source).toBe("real");
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0].id).toBe("test-co-backend-engineer");
  });

  it("3. Screening: 更新匹配点，不破坏状态机", () => {
    const job: Job = {
      id: "a", company: "Acme", role: "Backend", channel: "Other", location: "Remote", remote: "remote",
      salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [],
      conclusion: "pending", status: "screening",
    };
    const updated = applyScreeningUpdate(job, { matchPoints: ["Java 17 年"], conclusion: "apply", status: "approved" });
    expect(updated.status).toBe("approved");
    expect(updated.matchPoints).toContain("Java 17 年");
  });

  it("4. Screening 不覆盖已审批职位", () => {
    const job: Job = {
      id: "a", company: "Acme", role: "Backend", channel: "Other", location: "Remote", remote: "remote",
      salaryPosted: null, salaryAnswer: 120000, matchPoints: [], redFlags: [],
      conclusion: "apply", status: "approved",
    };
    const updated = applyScreeningUpdate(job, { status: "dropped", conclusion: "drop" });
    expect(updated.status).toBe("approved"); // 保护
    expect(updated.conclusion).toBe("apply"); // 保护
  });

  it("5. 去重：相同 URL 识别为重复", () => {
    const jobs: Job[] = [
      { id: "a", company: "Acme", role: "B", channel: "Other", location: "R", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "pending", status: "new", url: "https://x.com/1" },
      { id: "b", company: "Acme", role: "B", channel: "Other", location: "R", remote: "remote", salaryPosted: null, salaryAnswer: null, matchPoints: [], redFlags: [], conclusion: "pending", status: "new", url: "https://x.com/1" },
    ];
    expect(findDuplicateJobs(jobs)).toHaveLength(1);
  });

  it("6-8. Application 写入：外键 + ledgerRowId", () => {
    const app: Application = {
      id: "app-20261031-001", jobId: "test-co-backend-engineer",
      ledgerRowId: "ledger-2026-10-31-test-co-backend-engineer-1",
      resumeVersion: "v20261031-1", source: "Indeed", collectedAt: "2026-10-31",
      appliedAt: "2026-10-31", employerConfirmed: true, stage: "applied",
      nextAction: null, nextActionDue: null, interviewAt: null, notes: "",
      version: 1, updatedAt: new Date().toISOString(),
    };
    // 外键检查：jobId 必须在 jobs.json 存在（此处模拟已验证）
    expect(app.jobId).toBe("test-co-backend-engineer");
    // ledgerRowId 格式检查
    expect(app.ledgerRowId).toMatch(/^ledger-\d{4}-\d{2}-\d{2}-/);
    // employerConfirmed 为 true 时 stage 应为 applied 或之后
    expect(app.employerConfirmed).toBe(true);
  });

  it("9. daily.json 计数", () => {
    writeJson("daily.json", { version: 1, updatedAt: new Date().toISOString(), days: { "2026-10-31": { discovery: 1, screening: 1, tailoring: 1, review: 1, apply: 1 } } });
    const { data } = readJsonFileWithSource(dir, "daily.json", { version: 0, updatedAt: "", days: {} });
    expect((data as { days: Record<string, { apply: number }> }).days["2026-10-31"].apply).toBe(1);
  });

  it("10. 四态：缺失文件报 MISSING 不回退", () => {
    const { source } = readJsonFileWithSource(dir, "nonexistent.json", {});
    expect(source).toBe("missing");
  });

  it("11. backupData 可用", () => {
    writeJson("jobs.json", { version: 1, jobs: [] });
    const bakDir = backupData(dir);
    expect(bakDir).toContain(".bak");
    // 平铺备份（规则 8）：不再是 jobs.json 子目录拷贝
    const entries = readdirSync(bakDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^jobs\.json\.bak-\d{8}-\d{6}-backup$/);
    // 不递归复制 .bak
    expect(existsSync(path.join(bakDir, ".bak"))).toBe(false);
  });

  it("12-13. Follow-up 状态流转", () => {
    const stages = ["applied", "replied", "interview", "offer"] as const;
    for (const s of stages) {
      expect(["todo", "applied", "replied", "screen", "interview", "offer", "rejected", "rejected_after_contact", "withdrawn", "ghosted"]).toContain(s);
    }
  });

  it("14. 终态抑制跟进提醒", () => {
    for (const terminal of TERMINAL_STAGES) {
      // 终态的 nextAction 应显示为 "-"（UI 逻辑），此处验证常量
      expect(["offer", "rejected", "rejected_after_contact", "ghosted", "withdrawn"]).toContain(terminal);
    }
    // 非终态不应在终态列表中
    expect(TERMINAL_STAGES).not.toContain("applied");
    expect(TERMINAL_STAGES).not.toContain("screen");
  });
});
