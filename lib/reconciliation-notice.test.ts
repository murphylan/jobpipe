import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReconciliationNotice from "../components/ReconciliationNotice";

describe("Today reconciliation summary", () => {
  it("renders a single compact entry for many issues instead of one pill per record", () => {
    const issues = Array.from({ length: 40 }, (_, index) => ({ type: "mismatch", severity: index < 30 ? "red" : "yellow", title: `申请记录的台账行号不存在 ${index}`, detail: `原始问题 ${index}` }));
    const html = renderToStaticMarkup(createElement(ReconciliationNotice, { issues }));
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain("40 项提醒");
    expect(html).toContain("30 项异常");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain("申请记录的台账行号不存在");
    expect(issues).toHaveLength(40);
  });
  it("shows no notice when there are no issues and uses warning styling for non-errors", () => {
    expect(renderToStaticMarkup(createElement(ReconciliationNotice, { issues: [] }))).toBe("");
    const html = renderToStaticMarkup(createElement(ReconciliationNotice, { issues: [{ type: "unavailable", severity: "warning", title: "对账暂不可用", detail: "连接失败" }] }));
    expect(html).toContain("1 项提醒");
    expect(html).not.toContain("has-errors");
  });
});
