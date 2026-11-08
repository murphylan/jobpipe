import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import TaskList from "../components/TaskList";
import type { BusinessTask } from "./task-state";
const lastAt = "2026-11-08T00:00:00Z";
const tasks: BusinessTask[] = [{ jobId: "evolution", company: "EvolutionIQ", role: "Engineer", channel: "Email", businessStage: "tailoring", unfinished: true, runtime: { status: "running", source: "activity", detail: "准备材料", updatedAt: lastAt }, href: "/jobs-applications" }];
const snapshotMs = Date.parse(lastAt) + (35 * 60 + 59) * 1000;
afterEach(() => vi.useRealTimers());
const render = (nowMs: number) => renderToStaticMarkup(createElement(TaskList, { plan: 20, tasks, nowMs }));
it("keeps server and initial client markup identical across a minute boundary", () => {
  vi.useFakeTimers();
  vi.setSystemTime(snapshotMs);
  const server = render(snapshotMs);
  expect(server).toContain("35 分钟前");
  vi.setSystemTime(snapshotMs + 2000);
  expect(render(snapshotMs)).toBe(server);
});
it("updates elapsed time when the parent's synchronized poll timestamp advances", () => {
  expect(render(snapshotMs + 2000)).toContain("36 分钟前");
});
