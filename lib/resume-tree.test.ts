import { describe, expect, it } from "vitest";
import { buildResumeDependencies, visibleResumeRows } from "./resume-tree";
import type { ResumeFileEntry, ResumeVersionsFile, ResumeBlock } from "./datafiles";
const file: ResumeFileEntry = { name: "base.pdf", path: "data/resume-files/base.pdf", sizeBytes: 1024, modifiedAt: "", versions: ["v1"], recordRefs: 1, applicationRefs: 2, ledgerRefs: 1, totalRefs: 4 };
const versions: ResumeVersionsFile = { version: 1, updatedAt: "", selected: { base: "v1" }, versions: [
  { version: "v1", jobId: "base", file: "data/resume-files/BASE.pdf", createdAt: "2026-01-01", note: "基础版" },
  { version: "v2", jobId: "job-a", file: "missing.pdf", createdAt: "2026-01-02", note: "定制版" },
] };
const block: ResumeBlock = { id: "b1", title: "经历", body: "", source: "v1", kind: "experience", version: 1, updatedAt: "" };
describe("resume dependency table", () => {
  it("builds only recorded file/version/block edges and preserves counts and selection", () => {
    const roots = buildResumeDependencies([file], versions, [block]);
    expect(roots[0].file?.totalRefs).toBe(4);
    expect(roots[0].children.map(node => node.label)).toEqual(["v1"]);
    expect(roots[0].children[0].selected).toBe(true);
    expect(roots[0].children[0].children[0].label).toBe("经历");
    expect(roots).toHaveLength(1);
  });
  it("keeps existing files and unmatched blocks but excludes versions without an available PDF", () => {
    const roots = buildResumeDependencies([{ ...file, name: "orphan.pdf", versions: [] }], versions, [{ ...block, source: "unknown" }]);
    expect(roots[0].children).toEqual([]);
    expect(roots).toHaveLength(2);
    expect(roots[1].children[0].detail).toBe("来源：unknown");
  });
  it("does not reintroduce hidden version blocks as unlinked records or mutate input", () => {
    const input = structuredClone(versions);
    const roots = buildResumeDependencies([file], versions, [{ ...block, source: "v2" }]);
    expect(roots).toHaveLength(1);
    expect(roots[0].children[0].children).toEqual([]);
    expect(versions).toEqual(input);
  });
  it("collapses a whole subtree without hiding other roots and restores depths on expansion", () => {
    const roots = buildResumeDependencies([file], versions, [block]);
    expect(visibleResumeRows(roots, new Set()).map(row => row.depth)).toEqual([0, 1, 2]);
    expect(visibleResumeRows(roots, new Set([roots[0].id])).map(row => row.node.label)).toEqual(["base.pdf"]);
  });
  it("omits unavailable versions even when no base record exists", () => {
    const roots = buildResumeDependencies([], { ...versions, versions: [versions.versions[1]] }, []);
    expect(roots).toEqual([]);
    expect(buildResumeDependencies([], { ...versions, versions: [] }, [])).toEqual([]);
  });
});
