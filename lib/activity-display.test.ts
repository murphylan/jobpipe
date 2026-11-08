import { describe, expect, it } from "vitest";
import {
  buildRelayText,
  buildRerunText,
  displayStage,
  remainingStages,
  STAGES,
  STAGE_IDS,
  STATUS_COLORS,
  STATUS_LABELS,
  statusColor,
  statusLabel,
} from "./activity-display";

describe("activity display helpers (Doc-07 v3/v4)", () => {
  it("stages are the six Doc-00 pipeline stages in order", () => {
    expect(STAGE_IDS).toEqual(["discovery", "screening", "tailoring", "review", "apply", "ledger"]);
    expect(STAGES).toHaveLength(6);
  });

  it("displayStage prefers the explicit stage, else the kind mapping, else null", () => {
    expect(displayStage("screening", "apply")).toBe("apply");
    expect(displayStage("screening", "nope")).toBe("screening");
    expect(displayStage("screening", null)).toBe("screening");
    expect(displayStage("applying", null)).toBe("apply");
    expect(displayStage("gmail-check", null)).toBe("review");
    expect(displayStage("recording", null)).toBe("ledger");
    expect(displayStage("other", null)).toBe(null);
    expect(displayStage("unknown-kind", null)).toBe(null);
  });

  it("remainingStages returns the stages after the current one", () => {
    expect(remainingStages("screening")).toEqual(["tailoring", "review", "apply", "ledger"]);
    expect(remainingStages("apply")).toEqual(["ledger"]);
    expect(remainingStages("ledger")).toEqual([]);
    expect(remainingStages(null)).toEqual([]);
    expect(remainingStages("nope")).toEqual([]);
  });

  it("every status label has a color; unknown statuses fall back without throwing", () => {
    for (const key of Object.keys(STATUS_LABELS)) expect(STATUS_COLORS[key]).toBeTruthy();
    expect(statusColor("nope")).toBe("#333");
    expect(statusLabel("nope")).toBe("nope");
    expect(statusColor("running")).not.toBe(statusColor("waiting"));
    expect(statusLabel("running")).toBe("进行中");
  });
});

describe("buildRelayText (Doc-07 v7 copy bridge)", () => {
  it("carries explicit restart identity for both session and legacy activities", () => {
    expect(buildRerunText("Task", { activityId: "a", taskId: "t", runId: "r1" })).toContain("restartOf=r1");
    expect(buildRerunText("Task", { activityId: "a", taskId: "t" })).toContain("restartOf=t");
    expect(buildRerunText(" Task ")).toBe("重跑任务：Task");
  });
  it("wraps the question verbatim and appends the trimmed answer", () => {
    expect(buildRelayText("是否同意 Provn 的隐私协议？", "同意")).toBe("待定答复【是否同意 Provn 的隐私协议？】：同意");
    expect(buildRelayText("Coyote Rock 推荐人栏填什么？", "  Available upon request  ")).toBe(
      "待定答复【Coyote Rock 推荐人栏填什么？】：Available upon request",
    );
  });

  it("empty decision becomes 先放着 (park)", () => {
    expect(buildRelayText("是否同意？", "")).toBe("待定答复【是否同意？】：先放着");
    expect(buildRelayText("是否同意？", "   ")).toBe("待定答复【是否同意？】：先放着");
  });
});
