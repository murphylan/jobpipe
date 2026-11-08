import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TaskList from "../components/TaskList";
import type { BusinessTask } from "./task-state";
const task: BusinessTask = { jobId: "job", company: "Fixture Company", role: "Engineer", channel: "Indeed", businessStage: "apply", unfinished: true, runtime: { status: "waiting", detail: "已答复，等待 Agent 续跑信号", source: "waiting" }, href: "/jobs-applications?jobId=job" };
describe("Today renders the shared task projection", () => {
  it("shows business readiness separately from waiting runtime", () => {
    const html = renderToStaticMarkup(createElement(TaskList, { plan: 20, nowMs: Date.parse("2026-11-08T00:00:00Z"), tasks: [task] }));
    expect(html).toContain("Fixture Company");
    expect(html).toContain("待投递");
    expect(html).toContain("本次运行：等待中");
    expect(html).toContain("已答复，等待 Agent 续跑信号");
  });
  it("does not hide unfinished business just because its last run ended", () => {
    const html = renderToStaticMarkup(createElement(TaskList, { plan: 20, nowMs: Date.parse("2026-11-08T00:00:00Z"), tasks: [{ ...task, runtime: { status: "done", source: "activity", detail: "screening finished" } }] }));
    expect(html).toContain("Fixture Company");
    expect(html).toContain("待投递");
    expect(html).toContain("本次运行：已完成");
  });
});
