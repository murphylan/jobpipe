import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { productManualFingerprint, readProductManual } from "./product-manual";
const dirs: string[] = [];
afterEach(() => { while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true }); });
const fixture = () => { const dir = mkdtempSync(path.join(tmpdir(), "manual-test-")); dirs.push(dir); return dir; };
const writeManual = (root: string, content: string) => {
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "product-manual.md"), content);
};
it("loads the bundled manual from docs/product-manual.md", () => {
  const root = fixture();
  writeManual(root, "# Product guide");
  expect(readProductManual(root)).toBe("# Product guide");
});
it("returns null when the bundled manual is missing", () => {
  const root = fixture();
  expect(readProductManual(root)).toBeNull();
});
it("changes the cache fingerprint for loading, edits and removal", () => {
  const root = fixture();
  const fingerprint = () => productManualFingerprint(readProductManual(root));
  const empty = fingerprint();
  writeManual(root, "Version one");
  const loaded = fingerprint(); expect(loaded).not.toBe(empty);
  writeManual(root, "Version two");
  expect(fingerprint()).not.toBe(loaded);
  expect(fingerprint()).not.toContain(root);
});
