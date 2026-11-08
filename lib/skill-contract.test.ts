import { jobsFileSchema } from "./engine/schema";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { readSkillDocs } from "./datafiles";
import { loadRegistry } from "./engine/expand";
import { HIGH_APPROVAL_EVENTS } from "./engine/events3";
import { validEnvelope } from "./engine/envelope";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const docs = readSkillDocs(root);
const contract = docs.find(d => d.id === "inbox-contract")!.body;
it("loads only current documents and excludes local archived backup copies", () => {
  expect(docs).toHaveLength(10);
  expect(docs.some(d => d.id.includes("bak"))).toBe(false);
  expect(readdirSync(path.join(root, "docs/skill")).some(name => name.includes(".bak"))).toBe(false);
});
it("every local markdown reference resolves in the current document package", () => {
  for (const doc of docs) for (const match of doc.body.matchAll(/\]\(([^)]+\.md)\)/g)) expect(existsSync(path.resolve(root, "docs/skill", match[1])), `${doc.id}: ${match[1]}`).toBe(true);
});
it("active rules remove old direct-write loopholes, stale rule references and external-only contracts", () => {
  const text = docs.map(doc => doc.body).join("\n");
  for (const old of ["inbox 取消", "写 `daily-targets.json`", "changelog 记收工条", "规则 17③", "规则 11", "~/workspace/custom-skills", "data/ledger.csv", "例外：用户明确下令直接改", "只写 data/inbox/ 事件和 docs/ 文档"]) expect(text).not.toContain(old);
  expect(text).toContain("300 字符"); expect(text).toContain("用户已确认的事实");
  expect(text).toContain("SSN"); expect(text).toContain("companyContractAllowed 非 Yes");
});
it("documents every implemented event and correctly marks reserved names unsupported", () => {
  const events = loadRegistry(root)!.events!;
  for (const item of events.filter(item => item.handler !== null)) expect(contract, item.name).toContain(item.name);
  for (const event of HIGH_APPROVAL_EVENTS) expect(contract).toMatch(new RegExp(`${event}[^\\n]*高审批`));
  expect(contract).toContain("RESUME_VERSION_CHANGED / RECORD_DELETED"); expect(contract).toContain("当前不可执行");
});
it("the JSON example is an actual valid envelope and matches the DISCOVERED payload shape", () => {
  const examples = [...contract.matchAll(/```json\n([\s\S]*?)\n```/g)]; expect(examples.length).toBeGreaterThan(0);
  for (const match of examples) {
    const example = JSON.parse(match[1]); expect(validEnvelope(example)).toBe(true);
    expect(jobsFileSchema.safeParse({ version: 1, updatedAt: example.createdAt, jobs: [{ ...example.payload.job, status: "new" }] }).success).toBe(true);
    expect(example.event).toBe("DISCOVERED"); for (const field of ["id", "company", "role", "channel"]) expect(typeof example.payload.job[field]).toBe("string");
  }
});
it("ties completion, restart, PDF, business date and statistics to actual code contracts", () => {
  for (const word of ["runId", "sequence", "restartOf", "jobId", "inputHash", "committed / verified", "data/inbox/evidence/", "data/resume-files/<taskId>.pdf"]) expect(docs.map(d => d.body).join("\n")).toContain(word);
  const daily = readFileSync(path.join(root, "docs/skill/20-write-rules.md"), "utf8");
  expect(daily).toContain("finishedAt"); expect(daily).toContain("America/Chicago"); expect(daily).toContain("历史 daily 行");
});
