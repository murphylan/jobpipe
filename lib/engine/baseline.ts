// Stage 1 baseline capture and check (Doc-00 sections 8 and 9).
// A baseline is a snapshot of the files a ChangeSet was computed
// against: path, sha256, and per-format summary (JSON version,
// CSV data-row count and max numeric id). If any of those differ
// when the engine later applies the ChangeSet, it must refuse
// with a baseline mismatch instead of merging.
// This module does NOT read or write data/engine/state.json yet;
// state.json ownership lands with the commit step in later work.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import path from "node:path";
import { parseCsv } from "../csv.ts";

export type BaselineEntry = {
  path: string;
  exists: boolean;
  sha256: string | null;
  version: number | null;
  rows: number | null;
  maxId: number | null;
};

export type Baseline = {
  capturedAt: string;
  entries: BaselineEntry[];
};

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function captureBaseline(baseDir: string, relPaths: readonly string[]): Baseline {
  const dataDir = path.join(baseDir, "data");
  const entries: BaselineEntry[] = relPaths.map((rel) => {
    const full = path.join(dataDir, rel);
    if (!existsSync(full)) {
      return { path: rel, exists: false, sha256: null, version: null, rows: null, maxId: null };
    }
    function bytes(file: string): Buffer {
      const stat = lstatSync(file);
      if (stat.isSymbolicLink()) return Buffer.from(`symlink:${readlinkSync(file)}`);
      if (!stat.isDirectory()) return readFileSync(file);
      return Buffer.from(JSON.stringify(readdirSync(file).sort().map(name => [name, sha256Of(bytes(path.join(file, name)))])));
    }
    const buf = bytes(full);
    let version: number | null = null;
    let rows: number | null = null;
    let maxId: number | null = null;
    if (rel.endsWith(".json")) {
      try {
        const parsed = JSON.parse(buf.toString("utf-8")) as { version?: unknown };
        if (typeof parsed.version === "number") version = parsed.version;
      } catch {
        version = null;
      }
    } else if (rel.endsWith(".csv")) {
      const parsed = parseCsv(buf.toString("utf-8").replace(/^\uFEFF/, "").trim());
      if (parsed.length) {
        rows = parsed.length - 1;
        const ids = parsed.slice(1).map((r) => Number(r[0])).filter((n) => Number.isFinite(n));
        maxId = ids.length ? Math.max(...ids) : null;
      }
    }
    return { path: rel, exists: true, sha256: sha256Of(buf), version, rows, maxId };
  });
  return { capturedAt: new Date().toISOString(), entries };
}

export function checkBaseline(baseline: Baseline, baseDir: string): { ok: boolean; mismatches: string[] } {
  const current = captureBaseline(baseDir, baseline.entries.map((e) => e.path));
  const byPath = new Map(current.entries.map((e) => [e.path, e]));
  const mismatches: string[] = [];
  for (const expected of baseline.entries) {
    const actual = byPath.get(expected.path);
    if (!actual || !actual.exists) {
      if (expected.exists) mismatches.push(`${expected.path}: file is gone (was present at baseline)`);
      continue;
    }
    if (!expected.exists) {
      mismatches.push(`${expected.path}: file appeared after baseline`);
      continue;
    }
    if (actual.sha256 !== expected.sha256) mismatches.push(`${expected.path}: content changed (sha256 mismatch)`);
    if (actual.version !== expected.version) mismatches.push(`${expected.path}: version changed ${expected.version} -> ${actual.version}`);
    if (actual.rows !== expected.rows) mismatches.push(`${expected.path}: row count changed ${expected.rows} -> ${actual.rows}`);
    if (actual.maxId !== expected.maxId) mismatches.push(`${expected.path}: max id changed ${expected.maxId} -> ${actual.maxId}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}
