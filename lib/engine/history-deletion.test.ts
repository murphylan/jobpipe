import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { COLS } from "../ledger.ts";
import { csvRecords, deleteAuthorizedHistory, HISTORY_FILES, historyHash, type HistoryDeletionRequest } from "./history-deletion";
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
function fixture() {
  const base = mkdtempSync(path.join(tmpdir(), "history-deletion-")); dirs.push(base);
  mkdirSync(path.join(base, "data/mirror"), { recursive: true });
  const stamp = "2026-10-30T12:00:00Z";
  const app = (id: string) => ({ id, jobId: `job-${id}`, ledgerRowId: id, resumeVersion: "v1", source: "Indeed", collectedAt: stamp, appliedAt: stamp, employerConfirmed: true, stage: "applied", nextAction: null, nextActionDue: null, interviewAt: null, notes: "", version: 1, updatedAt: stamp });
  writeFileSync(path.join(base, "data/applications.json"), JSON.stringify({ applications: [app("1"), app("2")], version: 1, updatedAt: stamp }));
  writeFileSync(path.join(base, "data/activity.json"), JSON.stringify({ activities: ["remove", "keep"].map(activityId => ({ activityId, status: "done", kind: "other", title: activityId, startedAt: stamp, finishedAt: stamp, refs: [], note: "", evidence: [], taskId: activityId, createdAt: stamp })), version: 1, updatedAt: stamp }));
  const row = (id: string) => [id,"2026-10-30","Test Co","Engineer","https://example.invalid","Indeed","","fullstack","v1","","confirmed","confirmation email","applied","","","","","",""] .join(",") + "\r\n";
  writeFileSync(path.join(base, "data/mirror/ledger.csv"), COLS.join(",") + "\r\n" + row("1") + row("2"));
  writeFileSync(path.join(base, "data/changelog.json"), JSON.stringify({ entries: [{ at: stamp, action: "old", target: "old", version: 1, note: "keep" }] }));
  const request: HistoryDeletionRequest = { taskId: "authorized-delete-test", authorization: "User approved exact IDs", activityIds: ["remove"], applicationIds: ["1"], ledgerIds: ["1"], hashes: Object.fromEntries(HISTORY_FILES.map(file => [file, historyHash(readFileSync(path.join(base, "data", file), "utf8"))])) };
  return { base, request };
}
it("preserves CSV bytes including embedded newlines", () => {
  expect(csvRecords('id,note\r\n1,"a\nb"\r\n2,"a""b"\n')).toEqual(['id,note\r\n','1,"a\nb"\r\n','2,"a""b"\n']);
});
it("deletes exact IDs with backups, audit and idempotent receipt", () => {
  const { base, request } = fixture();
  const before = csvRecords(readFileSync(path.join(base, "data/mirror/ledger.csv"), "utf8"));
  const receipt = deleteAuthorizedHistory(base, request);
  expect(receipt.status).toBe("committed");
  expect(JSON.parse(readFileSync(path.join(base, "data/activity.json"), "utf8")).activities.map((a: { activityId: string }) => a.activityId)).toEqual(["keep"]);
  expect(JSON.parse(readFileSync(path.join(base, "data/applications.json"), "utf8")).applications.map((a: { id: string }) => a.id)).toEqual(["2"]);
  expect(readFileSync(path.join(base, "data/mirror/ledger.csv"), "utf8")).toBe(before[0] + before[2]);
  expect(JSON.parse(readFileSync(path.join(base, "data/changelog.json"), "utf8")).entries).toHaveLength(2);
  expect(readdirSync(path.join(base, "data/.bak"))).toHaveLength(4);
  expect(deleteAuthorizedHistory(base, request).inputHash).toBe(receipt.inputHash);
});
it("refuses changed input before deleting", () => {
  const { base, request } = fixture();
  writeFileSync(path.join(base, "data/activity.json"), "{}\n");
  expect(() => deleteAuthorizedHistory(base, request)).toThrow("Source changed");
  expect(JSON.parse(readFileSync(path.join(base, "data/applications.json"), "utf8")).applications).toHaveLength(2);
});
it("refuses deletion of a ledger row still referenced by a retained application", () => {
  const { base, request } = fixture(); request.applicationIds = [];
  expect(() => deleteAuthorizedHistory(base, request)).toThrow("still referenced");
});
