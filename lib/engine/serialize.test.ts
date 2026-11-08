import { describe, expect, it } from "vitest";
import { canonicalJson, csvField, serializeLedgerCsv } from "./serialize";

describe("engine serialize", () => {
  it("canonical JSON uses 2-space indent, preserves key order, ends with exactly one newline", () => {
    const out = canonicalJson({ jobs: [], version: 1, updatedAt: "2026-11-01T00:00:00Z" });
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
    expect(out.indexOf('"jobs"')).toBeLessThan(out.indexOf('"version"'));
    expect(out).toContain('  "version": 1');
  });

  it("CSV quotes commas, doubled quotes and newlines", () => {
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
    expect(csvField("plain")).toBe("plain");
  });

  it("ledger CSV writes 19 columns and refuses a short row", () => {
    const row = new Array(19).fill("");
    row[0] = "34";
    row[2] = "Test, Co";
    const out = serializeLedgerCsv([row]);
    expect(out.split("\n")[1]).toContain('"Test, Co"');
    expect(() => serializeLedgerCsv([new Array(18).fill("")])).toThrow();
  });
});
