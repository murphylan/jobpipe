import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import DetailDrawer from "../components/DetailDrawer";
import { ActivityFeedRow, StageBar } from "../components/views/ActivityView";
it("stage display does not fabricate completed previous stages or future tasks", () => {
  const markup = renderToStaticMarkup(createElement(StageBar, { entry: { activityId: "a", kind: "applying", stage: "apply", title: "Apply", status: "running", startedAt: "", finishedAt: null, refs: [], note: "", evidence: [], taskId: "t", createdAt: "" } }));
  expect(markup).toContain("其他阶段未核验"); expect(markup).not.toContain("✓"); expect(markup).not.toContain("待执行：");
});

it("activity rows emphasize progress and keep evidence and technical identities out of the list", () => {
  const markup = renderToStaticMarkup(createElement(ActivityFeedRow, { entry: { activityId: "PRIVATE_ACTIVITY_ID", runId: "PRIVATE_RUN_ID", taskId: "PRIVATE_TASK_ID", jobId: "PRIVATE_JOB_ID", kind: "screening", stage: "screening", title: "筛选工程师岗位", status: "running", startedAt: "2026-11-07T00:00:00Z", finishedAt: null, refs: ["PRIVATE_RECEIPT_ID"], note: "正在核对薪资与工作地点", evidence: [{ kind: "receipt", text: "PRIVATE_EVIDENCE_BODY" }], createdAt: "2026-11-07T00:01:00Z", sequence: 12 }, now: Date.parse("2026-11-07T00:02:00Z"), onOpen: () => {} }));
  expect(markup).toContain("筛选工程师岗位"); expect(markup).toContain("进行中"); expect(markup).toContain("正在核对薪资与工作地点");
  expect(markup).not.toContain("PRIVATE_"); expect(markup).not.toContain("查看证据");
});

it("details use a named modal drawer while preserving its complete content", () => {
  const markup = renderToStaticMarkup(createElement(DetailDrawer, { title: "活动详情", onClose: () => {}, children: createElement("p", null, "完整证据与运行编号") }));
  expect(markup).toContain('role="dialog"'); expect(markup).toContain('aria-modal="true"'); expect(markup).toContain('aria-label="活动详情"');
  expect(markup).toContain("完整证据与运行编号"); expect(markup).toContain("关闭抽屉");
});
