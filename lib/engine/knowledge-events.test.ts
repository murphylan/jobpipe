import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { POST } from "../../app/api/knowledge/route";
import { POST as archive } from "../../app/api/knowledge/archive/route";
import { readKnowledge } from "../knowledge";
import { processInboxOnce } from "./daemon";
import { applyKnowledgeChanged } from "./knowledge-events";
const dirs: string[] = [];
const previous = process.env.PIPELINE_DIR;
afterEach(() => { if (previous === undefined) delete process.env.PIPELINE_DIR; else process.env.PIPELINE_DIR = previous; dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
function fixture() { const base = mkdtempSync(path.join(tmpdir(), "jobpipe-knowledge-")); dirs.push(base); mkdirSync(path.join(base, "data/inbox"), { recursive: true }); process.env.PIPELINE_DIR = base; return base; }
function req(body: unknown) { return new Request("http://localhost/api/knowledge", { method: "POST", body: JSON.stringify(body) }); }
async function submit(base: string, body: unknown, endpoint = POST) {
  const res = await endpoint(req(body)); expect(res.status).toBe(202);
  const value = await res.json(); const file = path.join(base, "data/inbox", `${value.taskId}.json`);
  utimesSync(file, new Date(0), new Date(0)); return { file, taskId: value.taskId };
}
it("API only queues; Engine applies add/archive/restore and receipts establish completion", async () => {
  const base = fixture();
  const added = await submit(base, { title: "Decision", body: "Keep history" });
  expect(existsSync(path.join(base, "data/knowledge.json"))).toBe(false);
  expect(processInboxOnce(base)[0].outcome).toBe("committed");
  let knowledge = readKnowledge(base); expect(knowledge.entries[0].title).toBe("Decision");
  const bytes = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  await submit(base, { id: knowledge.entries[0].id, archived: true }, archive);
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(bytes);
  processInboxOnce(base); knowledge = readKnowledge(base); expect(knowledge.entries[0].archived).toBe(true);
  await submit(base, { id: knowledge.entries[0].id, archived: false }, archive);
  processInboxOnce(base); expect(readKnowledge(base).entries[0].archived).toBe(false);
  expect(JSON.parse(readFileSync(path.join(base, "data/receipts", `${added.taskId}.json`), "utf8")).status).toBe("committed");
});
it("keeps all reread history beyond 100 entries", () => {
  const base = fixture(); const rereads = Array.from({ length: 120 }, (_, i) => ({ at: "2026-11-06T00:00:00Z", taskId: `history-${i}`, count: 0 }));
  writeFileSync(path.join(base, "data/knowledge.json"), JSON.stringify({ version: 1, updatedAt: "", entries: [], rereads }));
  expect(applyKnowledgeChanged(base, { taskId: "read", event: "KNOWLEDGE_CHANGED", createdAt: "2026-11-06T01:00:00Z", payload: { action: "reread" } }).ok).toBe(true);
  expect(readKnowledge(base).rereads).toHaveLength(121); expect(readKnowledge(base).rereads.slice(0, 120)).toEqual(rereads);
});
it("corrupt knowledge fails closed without replacing any byte", async () => {
  const base = fixture(); writeFileSync(path.join(base, "data/knowledge.json"), "{broken");
  await submit(base, { title: "Test", body: "Body" });
  expect(processInboxOnce(base)[0].outcome).toBe("rejected");
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe("{broken");
});
it.each([null, [], { title: 7, body: "text" }, { title: "t", body: "b", tags: [null] }])("rejects malformed UI bodies %j", async body => {
  fixture(); expect((await POST(req(body))).status).toBe(400);
});

it("UI edits queue an atomic revision, preserve the original, and only Engine changes the business file", async () => {
  const base = fixture();
  await submit(base, { title: "Account method", body: "Use email", tags: ["agent-context"] });
  processInboxOnce(base);
  const original = readKnowledge(base).entries[0];
  const before = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  const update = await submit(base, { action: "update", id: original.id, expectedUpdatedAt: original.updatedAt, title: "Updated method", body: "Use company email", tags: ["agent-context", "account"] });
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(before);
  expect(processInboxOnce(base)[0].outcome).toBe("committed");
  const data = readKnowledge(base);
  expect(data.entries).toHaveLength(2);
  expect(data.entries[0]).toMatchObject({ id: `k-${update.taskId}`, supersedes: original.id, title: "Updated method", body: "Use company email", tags: ["agent-context", "account"], archived: false });
  expect(data.entries[1]).toMatchObject({ id: original.id, title: original.title, body: original.body, tags: original.tags, archived: true });
  expect(data.entries[1].archivedAt).toBeTruthy();
  expect(data.version).toBe(JSON.parse(before).version + 1);
  expect(JSON.parse(readFileSync(path.join(base, `data/receipts/${update.taskId}.json`), "utf8")).status).toBe("committed");
  // Exact delivery retry must not create a second revision.
  const archivedEnvelope = readFileSync(path.join(base, `data/processed/${update.taskId}.json`));
  writeFileSync(update.file, archivedEnvelope); utimesSync(update.file, new Date(0), new Date(0));
  const saved = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  expect(processInboxOnce(base)[0].outcome).toBe("duplicate");
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(saved);
});

it("rejects concurrent edits to the same original instead of silently overwriting either history", async () => {
  const base = fixture();
  await submit(base, { title: "Original", body: "Original body" }); processInboxOnce(base);
  const entry = readKnowledge(base).entries[0];
  const payload = { action: "update", id: entry.id, expectedUpdatedAt: entry.updatedAt, body: "New body", tags: [] };
  await submit(base, { ...payload, title: "Edit A" });
  await submit(base, { ...payload, title: "Edit B" });
  const results = processInboxOnce(base);
  expect(results.map(result => result.outcome).sort()).toEqual(["committed", "rejected"]);
  const data = readKnowledge(base);
  expect(data.entries.filter(item => !item.archived)).toHaveLength(1);
  expect(data.entries.find(item => item.id === entry.id)?.body).toBe("Original body");
  expect(data.entries).toHaveLength(2);
});

it("rejects stale, missing and archived update targets without changing knowledge", async () => {
  const base = fixture();
  await submit(base, { title: "Original", body: "Body" }); processInboxOnce(base);
  const entry = readKnowledge(base).entries[0];
  for (const override of [{ expectedUpdatedAt: "stale" }, { id: "missing" }]) {
    const bytes = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
    await submit(base, { action: "update", id: entry.id, expectedUpdatedAt: entry.updatedAt, title: "New", body: "New", ...override });
    expect(processInboxOnce(base)[0].outcome).toBe("rejected");
    expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(bytes);
  }
  await submit(base, { id: entry.id, archived: true }, archive); processInboxOnce(base);
  const archived = readKnowledge(base).entries[0], bytes = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  await submit(base, { action: "update", id: entry.id, expectedUpdatedAt: archived.updatedAt, title: "New", body: "New" });
  expect(processInboxOnce(base)[0].outcome).toBe("rejected");
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(bytes);
});

it.each([
  { action: "update", id: "entry", title: "Title", body: "Body" },
  { action: "update", expectedUpdatedAt: "now", title: "Title", body: "Body" },
  { action: "update", id: "entry", expectedUpdatedAt: "now", title: " ", body: "Body" },
])("rejects malformed edit requests before inbox publication: %j", async body => {
  const base = fixture();
  expect((await POST(req(body))).status).toBe(400);
  expect(existsSync(path.join(base, "data/knowledge.json"))).toBe(false);
});
