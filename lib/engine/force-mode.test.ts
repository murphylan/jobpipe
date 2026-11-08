import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isForceModeEnabled, enableForceMode, disableForceMode, extractModifiedFiles, checkForceMode } from "./force-mode";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) rmSync(temps.pop()!, { recursive: true, force: true });
});

const REGISTRY_YAML = `version: 2
events:
  - name: "APPLICATION_SUBMITTED"
    description: "test"
    requiresApproval: true
    writes:
      - "data/jobs.json"
      - "data/applications.json"
    handler: "expandApplicationSubmitted"
`;

function fixture(): string {
  const base = mkdtempSync(path.join(tmpdir(), "engine-forcemode-"));
  temps.push(base);
  mkdirSync(path.join(base, "data", "mirror"), { recursive: true });
  mkdirSync(path.join(base, "lib", "engine"), { recursive: true });
  writeFileSync(path.join(base, "lib", "engine", "registry.yaml"), REGISTRY_YAML);
  // Minimal data files for baseline.
  writeFileSync(path.join(base, "data", "jobs.json"), JSON.stringify({ jobs: [], version: 1 }));
  return base;
}

describe("engine force mode (FR-8)", () => {
  it("is off by default", () => {
    const base = fixture();
    expect(isForceModeEnabled(base)).toBe(false);
  });

  it("can be enabled and disabled", () => {
    const base = fixture();
    enableForceMode(base, "user", "test");
    expect(isForceModeEnabled(base)).toBe(true);
    disableForceMode(base, "user", "test done");
    expect(isForceModeEnabled(base)).toBe(false);
  });

  it("extractModifiedFiles parses mismatch strings", () => {
    const mismatches = [
      "data/jobs.json: content changed (sha256 mismatch)",
      "data/applications.json: version changed 1 -> 2",
      "data/jobs.json: row count changed 5 -> 6", // duplicate path
    ];
    const files = extractModifiedFiles(mismatches);
    expect(files).toContain("data/jobs.json");
    expect(files).toContain("data/applications.json");
    expect(files).toHaveLength(2); // deduped
  });

  it("does not block when force mode is off", () => {
    const base = fixture();
    // Force mode off by default.
    const result = checkForceMode(base, "APPLICATION_SUBMITTED");
    expect(result.blocked).toBe(false);
  });

  it("does not block when no external modifications", () => {
    const base = fixture();
    enableForceMode(base, "user", "test");
    // No state.json exists, so detectExternalModifications returns stateMissing.
    // checkForceMode should not block when there are no mismatches.
    const result = checkForceMode(base, "APPLICATION_SUBMITTED");
    // Without state.json, mismatches is empty, so not blocked.
    expect(result.blocked).toBe(false);
  });
});
