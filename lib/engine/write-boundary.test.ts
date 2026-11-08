import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { processInboxOnce } from "./daemon";
import { beginJournal, deferJournalCommit, recoverJournals } from "./journal";
import { readReceipt, writeReceipt } from "./receipt";
import { readKnowledge } from "../knowledge";
import { prepareResumeEvidence } from "./resume-evidence";
import { acquireLock, releaseLock } from "./lock";
import * as storage from "./storage";

const dirs: string[] = [];
afterEach(() => { vi.restoreAllMocks(); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
function fixture() { const base = mkdtempSync(path.join(tmpdir(), "jobpipe-boundary-")); dirs.push(base); mkdirSync(path.join(base, "data/inbox/decisions"), { recursive: true }); return base; }
function event(taskId = "event", payload = { action: "add", title: "Test", body: "Body", tags: [] }) { return { taskId, event: "KNOWLEDGE_CHANGED", createdAt: "2026-11-06T00:00:00Z", payload }; }
function inbox(base: string, body: unknown, filename = "event", sub = "") {
  const file = path.join(base, "data/inbox", sub, `${filename}.json`); writeFileSync(file, JSON.stringify(body)); utimesSync(file, new Date(0), new Date(0)); return file;
}
it("rolls back interrupted business writes before receipt and replays exactly once", () => {
  const base = fixture(); inbox(base, event());
  const original = storage.atomicWriteFileSync;
  const spy = vi.spyOn(storage, "atomicWriteFileSync").mockImplementation((file, data, encoding) => {
    if (file === path.join(base, "data/receipts/event.json")) throw new Error("injected receipt failure");
    return original(file, data, encoding);
  });
  expect(() => processInboxOnce(base)).toThrow("injected receipt failure");
  expect(readKnowledge(base).entries).toHaveLength(1);
  expect(existsSync(path.join(base, "data/.journal/event.json"))).toBe(true);
  spy.mockRestore();
  expect(processInboxOnce(base)[0].outcome).toBe("committed");
  expect(readKnowledge(base).entries).toHaveLength(1); expect(readKnowledge(base).version).toBe(2);
  expect(readdirSync(path.join(base, "data/.journal"))).toEqual([]);
});
it("a durable Receipt before archive prevents a second business write and preserves audit bytes", () => {
  const base = fixture(); const body = event(); inbox(base, body); processInboxOnce(base);
  const business = readFileSync(path.join(base, "data/knowledge.json"), "utf8");
  const receipt = readFileSync(path.join(base, "data/receipts/event.json"), "utf8");
  writeFileSync(path.join(base, "data/engine-force-mode.json"), JSON.stringify({ enabled: true }));
  inbox(base, body); expect(processInboxOnce(base)[0].outcome).toBe("duplicate");
  expect(readFileSync(path.join(base, "data/knowledge.json"), "utf8")).toBe(business);
  expect(readFileSync(path.join(base, "data/receipts/event.json"), "utf8")).toBe(receipt);
  expect(readdirSync(path.join(base, "data/processed")).filter(f => f.endsWith(".json"))).toHaveLength(2);
  inbox(base, { ...body, payload: { ...body.payload, title: "conflict" } });
  expect(processInboxOnce(base)[0].summary).toContain("E_ID_CONFLICT");
  expect(readFileSync(path.join(base, "data/receipts/event.json"), "utf8")).toBe(receipt);
});
it("recovers all journals even when their inbox events are absent", () => {
  const base = fixture(); const file = path.join(base, "data/knowledge.json"); writeFileSync(file, "original");
  beginJournal(base, "orphan", ["knowledge.json"]); writeFileSync(file, "interrupted");
  processInboxOnce(base); expect(readFileSync(file, "utf8")).toBe("original");
});
it("recovery retains committed data if termination happened before journal cleanup", () => {
  const base = fixture(); const file = path.join(base, "data/knowledge.json"); writeFileSync(file, "old");
  deferJournalCommit(base, () => beginJournal(base, "saved", ["knowledge.json"])); writeFileSync(file, "committed");
  mkdirSync(path.join(base, "data/receipts"));
  writeFileSync(path.join(base, "data/receipts/saved.json"), JSON.stringify({ taskId: "saved", event: "KNOWLEDGE_CHANGED", status: "committed", createdAt: "2026-11-06T00:00:00Z", summary: "saved" }));
  recoverJournals(base); expect(readFileSync(file, "utf8")).toBe("committed");
});
it.each([null, [], { ...event(), taskId: "../../escape" }, { ...event(), payload: null }, { ...event(), evidence: [null] }])("rejects malformed event envelopes %j", body => {
  const base = fixture(); inbox(base, body); expect(processInboxOnce(base)[0].outcome).toBe("rejected"); expect(existsSync(path.join(base, "data/knowledge.json"))).toBe(false);
});
it.each([null, { taskId: "../../escape", approved: false }])("rejects unsafe approval decisions %j", body => {
  const base = fixture(); inbox(base, body, "decision", "decisions"); expect(processInboxOnce(base)[0].outcome).toBe("rejected");
});
it("replayed denial cannot replace a committed receipt", () => {
  const base = fixture(); writeReceipt(base, { taskId: "event", event: "PROFILE_CHANGED", status: "committed", createdAt: "2026-11-06T00:00:00Z", summary: "original" });
  const bytes = readFileSync(path.join(base, "data/receipts/event.json"), "utf8"); inbox(base, { taskId: "event", approved: false }, "event", "decisions");
  expect(processInboxOnce(base)[0].outcome).toBe("duplicate"); expect(readFileSync(path.join(base, "data/receipts/event.json"), "utf8")).toBe(bytes);
});
it("a second process cannot run once while the writer holds the lock", () => {
  const base = fixture(); expect(acquireLock(base)).toBe(true);
  try {
    const moduleUrl = new URL("./daemon.ts", import.meta.url).href;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `import { processInboxOnce } from ${JSON.stringify(moduleUrl)}; processInboxOnce(${JSON.stringify(base)});`], { encoding: "utf8" });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain("engine already running");
  } finally { releaseLock(base); }
});
it("receipt and journal APIs reject traversal even outside the daemon", () => {
  const base = fixture(); expect(() => readReceipt(base, "../escape")).toThrow("unsafe taskId"); expect(() => beginJournal(base, "../escape", [])).toThrow("unsafe taskId"); expect(() => beginJournal(base, "safe", ["../escape"])).toThrow("unsafe journal path");
});
it("PDF promotion validates inbox origins, content and symlinks; never overwrites a formal artifact", () => {
  const base = fixture(); mkdirSync(path.join(base, "data/inbox/evidence"));
  const source = path.join(base, "data/inbox/evidence/resume.pdf"); writeFileSync(source, "%PDF-1.4 fixture");
  for (const bad of ["data/resume-files/old.pdf", "../resume.pdf", "/tmp/resume.pdf"]) expect(() => prepareResumeEvidence(base, "pdf", bad)).toThrow();
  const prepared = prepareResumeEvidence(base, "pdf", "data/inbox/evidence/resume.pdf"); prepared.promote();
  expect(readFileSync(path.join(base, prepared.file), "utf8")).toBe("%PDF-1.4 fixture");
  expect(() => prepareResumeEvidence(base, "pdf", "data/inbox/evidence/resume.pdf")).toThrow("destination already exists");
  writeFileSync(source, "not a pdf"); expect(() => prepareResumeEvidence(base, "other", "data/inbox/evidence/resume.pdf")).toThrow("PDF header");
  symlinkSync(source, path.join(base, "data/inbox/evidence/link.pdf")); expect(() => prepareResumeEvidence(base, "other", "data/inbox/evidence/link.pdf")).toThrow();
});

it.each(["before-receipt", "after-receipt"])("recovers after SIGKILL %s using the actual handler and daemon replay", point => {
  const base = fixture(); const body = event(); inbox(base, body);
  const handler = new URL("./knowledge-events.ts", import.meta.url).href;
  const journal = new URL("./journal.ts", import.meta.url).href;
  const receipts = new URL("./receipt.ts", import.meta.url).href;
  const identity = new URL("./envelope.ts", import.meta.url).href;
  const script = `
    import { applyKnowledgeChanged } from ${JSON.stringify(handler)};
    import { deferJournalCommit } from ${JSON.stringify(journal)};
    import { writeReceipt, setReceiptIdentity } from ${JSON.stringify(receipts)};
    import { eventHash } from ${JSON.stringify(identity)};
    const base = ${JSON.stringify(base)}, event = ${JSON.stringify(body)};
    deferJournalCommit(base, () => {
      const result = applyKnowledgeChanged(base, event);
      if (!result.ok) throw new Error(result.errors.join('; '));
      if (${JSON.stringify(point)} === 'after-receipt') {
        setReceiptIdentity(base, event.taskId, eventHash(event));
        writeReceipt(base, { taskId: event.taskId, event: event.event, status: 'committed', createdAt: event.createdAt, summary: result.summary });
      }
      process.kill(process.pid, 'SIGKILL');
    });`;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8" });
  expect(child.signal, child.stderr).toBe("SIGKILL");
  expect(processInboxOnce(base)[0].outcome).toBe(point === "before-receipt" ? "committed" : "duplicate");
  expect(readKnowledge(base).entries).toHaveLength(1);
  expect(readKnowledge(base).version).toBe(2);
});
it("waiting answer/delete replays leave business history and receipts unchanged", () => {
  const base = fixture();
  inbox(base, { taskId: "waiting", event: "AGENT_WAITING", createdAt: "2026-11-06T00:00:00Z", payload: { waitingId: "question", question: "Proceed?" } }, "waiting");
  expect(processInboxOnce(base)[0].outcome).toBe("committed");
  const answer = { waitingId: "question", action: "answer", answer: "Yes" };
  inbox(base, answer, "decision-waiting-question", "decisions");
  expect(processInboxOnce(base)[0].outcome).toBe("committed");
  const changelog = readFileSync(path.join(base, "data/changelog.json"), "utf8");
  const receipt = readFileSync(path.join(base, "data/receipts/waiting-answer-question.json"), "utf8");
  inbox(base, answer, "decision-waiting-question", "decisions"); expect(processInboxOnce(base)[0].outcome).toBe("duplicate");
  expect(readFileSync(path.join(base, "data/changelog.json"), "utf8")).toBe(changelog);
  expect(readFileSync(path.join(base, "data/receipts/waiting-answer-question.json"), "utf8")).toBe(receipt);
  const deletion = { scope: "waiting", id: "question" };
  inbox(base, deletion, "decision-delete-waiting-question", "decisions"); expect(processInboxOnce(base)[0].outcome).toBe("committed");
  const removed = readFileSync(path.join(base, "data/changelog.json"), "utf8");
  inbox(base, deletion, "decision-delete-waiting-question", "decisions"); expect(processInboxOnce(base)[0].outcome).toBe("duplicate");
  expect(readFileSync(path.join(base, "data/changelog.json"), "utf8")).toBe(removed);
});
it("force mode detects newly monitored knowledge files and cannot overwrite prior receipts", async () => {
  const base = fixture();
  const { writeState } = await import("./state");
  const { checkForceMode } = await import("./force-mode");
  mkdirSync(path.join(base, "lib/engine"), { recursive: true });
  writeFileSync(path.join(base, "lib/engine/registry.yaml"), readFileSync(new URL("./registry.yaml", import.meta.url)));
  writeState(base, null);
  writeFileSync(path.join(base, "data/knowledge.json"), JSON.stringify({ version: 1, updatedAt: "", entries: [], rereads: [] }));
  writeFileSync(path.join(base, "data/engine-force-mode.json"), JSON.stringify({ enabled: true }));
  expect(checkForceMode(base, "KNOWLEDGE_CHANGED").blocked).toBe(true);
  inbox(base, event()); expect(processInboxOnce(base)[0].outcome).toBe("rejected"); expect(readKnowledge(base).entries).toEqual([]);
});
it("every implemented registry event exposes its write set, including inline YAML arrays", async () => {
  const { loadRegistry } = await import("./expand");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const events = loadRegistry(root)!.events!;
  for (const item of events.filter(e => e.handler !== null)) expect(item.writes.length, item.name).toBeGreaterThan(0);
  expect(events.find(e => e.name === "FOLLOWUP_RECEIVED")!.writes).toContain("data/mirror/ledger.csv");
  expect(events.find(e => e.name === "DISCOVERED")!.writes).toContain("data/daily.json");
});
it("baseline detects new PDF artifacts and later byte changes", async () => {
  const base = fixture(); const { writeState } = await import("./state"); const { detectExternalModifications } = await import("./external");
  writeState(base, null); mkdirSync(path.join(base, "data/resume-files")); writeFileSync(path.join(base, "data/resume-files/new.pdf"), "%PDF-fixture");
  expect(detectExternalModifications(base).mismatches.join(";")).toContain("resume-files");
  writeState(base, "test"); writeFileSync(path.join(base, "data/resume-files/new.pdf"), "%PDF-modified");
  expect(detectExternalModifications(base).mismatches.join(";")).toContain("sha256 mismatch");
});
it("committing an unrelated event does not bless external changes into the baseline", async () => {
  const base = fixture(); const { writeState } = await import("./state"); const { detectExternalModifications } = await import("./external");
  writeState(base, null);
  writeFileSync(path.join(base, "data/profile.json"), JSON.stringify({ version: 1, updatedAt: "", legalFirstName: "External" }));
  inbox(base, event()); expect(processInboxOnce(base)[0].outcome).toBe("committed");
  expect(detectExternalModifications(base).mismatches.join(";")).toContain("profile.json");
  expect(detectExternalModifications(base).mismatches.join(";")).not.toContain("knowledge.json");
});
