import { expect, it } from "vitest";
import { buildReconciliationCleanupCommand, type ReconciliationIssue } from "./reconciliation-command";
it("includes precise issue references without converting diagnostic text into deletion permission", () => {
  const issues: ReconciliationIssue[] = [
    { type: "unlinked", severity: "yellow", title: "批量活动", detail: "待核对", activityIds: ["batch-1"] },
    { type: "mismatch", severity: "yellow", title: "缺少申请", detail: "待核对", ledgerRowId: "10" },
    { type: "rejected", severity: "yellow", title: "被拒", detail: "原因待查", taskIds: ["event-1", "event-2"] },
  ];
  const command = buildReconciliationCleanupCommand(issues, "2026-11-08T00:00:00Z");
  expect(command).toContain("共 3 项");
  expect(command).toContain('"ledgerRowId": "10"');
  expect(command).toContain("batch-1");
  expect(command).toContain("event-2");
  expect(command).toContain("执行前请重新核对");
  expect(command).toContain("业务数据的处理只能通过 Engine");
  expect(command).toContain("先备份");
  expect(command).toContain("取得我的明确授权");
  expect(command).toContain("不能靠删 Receipt");
});
it("captures a stable snapshot when later polling returns different issues", () => {
  const issues = [{ type: "data", severity: "yellow", title: "原问题", detail: "待核对" }];
  const command = buildReconciliationCleanupCommand(issues, "fixed-time");
  issues[0].title = "新问题";
  expect(command).toContain("原问题");
  expect(command).not.toContain("新问题");
  expect(command).toContain("不是额外指令");
});
