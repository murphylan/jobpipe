import { readProductManual, productManualFingerprint } from "./product-manual.ts";
import { dataRoot } from "./data-root.ts";
import fs from "node:fs";
import path from "node:path";
import { chicagoToday, parseLedger, type Row } from "./ledger";

export type Stages = { discovery: number; screening: number; tailoring: number; review: number; apply: number };
export type Snapshot = { source: "live" | "sample" | "missing" | "corrupt"; dir: string; version: string; generatedAt: string; today: string; ledgerUpdatedAt: string | null; ledger: Row[]; stages: Stages };

const ZERO_STAGES: Stages = { discovery: 0, screening: 0, tailoring: 0, review: 0, apply: 0 };

/** mtime+size fingerprint over a subtree (relative paths, sorted). Skips .bak. */
function subtreeFingerprint(root: string, prefix: string): string {
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir).sort()) {
      if (f === ".bak") continue;
      const p = path.join(dir, f);
      const s = fs.statSync(p);
      if (s.isDirectory()) walk(p, rel ? `${rel}/${f}` : f);
      else out.push(`${prefix}/${rel ? `${rel}/` : ""}${f}:${s.mtimeMs}-${s.size}`);
    }
  };
  walk(root, "");
  return out.join("|");
}

/** mtime+size fingerprint over data/*.json, docs/skill/*.md, data/resume-files/* and data/sample/* — any change triggers a frontend refresh. */
function jsonFingerprint(baseDir: string): string {
  const parts: string[] = [];
  const dataDir = path.join(baseDir, "data");
  if (fs.existsSync(dataDir)) {
    parts.push(fs.readdirSync(dataDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => { const s = fs.statSync(path.join(dataDir, f)); return `${f}:${s.mtimeMs}-${s.size}`; })
      .join("|"));
  } else {
    parts.push("no-data");
  }
  // 2026-10-31 GAP-7: docs/skill/*.md 变更也要触发 Skill 页刷新
  const skillDir = path.join(baseDir, "docs/skill");
  if (fs.existsSync(skillDir)) {
    parts.push(fs.readdirSync(skillDir)
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => { const s = fs.statSync(path.join(skillDir, f)); return `skill/${f}:${s.mtimeMs}-${s.size}`; })
      .join("|"));
  }
  // 2026-11-01: 嵌套文件（简历 PDF、sample）也要触发刷新
  parts.push(subtreeFingerprint(path.join(dataDir, "resume-files"), "resume-files"));
  parts.push(subtreeFingerprint(path.join(dataDir, "sample"), "sample"));
  parts.push(productManualFingerprint(readProductManual()));
  return parts.join("||");
}

/** Stages for today from data/daily.json (written by Muse at 收工). Never throws: bad JSON -> zero stages. */
function readDailyStages(baseDir: string, today: string): { stages: Stages; fp: string } {
  const p = path.join(baseDir, "data/daily.json");
  if (!fs.existsSync(p)) return { stages: { ...ZERO_STAGES }, fp: "no-daily" };
  const st = fs.statSync(p);
  const fp = `${st.mtimeMs}-${st.size}`;
  try {
    const d = (JSON.parse(fs.readFileSync(p, "utf-8")) as { days?: Record<string, Partial<Stages>> }).days?.[today];
    if (!d) return { stages: { ...ZERO_STAGES }, fp };
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return { stages: { discovery: n(d.discovery), screening: n(d.screening), tailoring: n(d.tailoring), review: n(d.review), apply: n(d.apply) }, fp };
  } catch {
    return { stages: { ...ZERO_STAGES }, fp };
  }
}

/**
 * Mirror mode (highest priority): Muse syncs the VM pipeline to the Mac —
 * data/mirror/ledger.csv + data/daily.json. Counts as "live".
 */
function mirrorSnapshot(baseDir: string, now: Date, today: string): Snapshot | null {
  const ledgerPath = path.join(baseDir, "data/mirror/ledger.csv");
  if (!fs.existsSync(ledgerPath)) return null;
  const st = fs.statSync(ledgerPath);
  const { stages, fp: dailyFp } = readDailyStages(baseDir, today);
  const version = `mirror-${st.mtimeMs}-${st.size}-${dailyFp}-${Object.values(stages).join(".")}-${jsonFingerprint(baseDir)}-${today}`;
  return {
    source: "live", dir: path.join(baseDir, "data/mirror"), version,
    generatedAt: now.toISOString(), today, ledgerUpdatedAt: st.mtime.toISOString(),
    ledger: parseLedger(fs.readFileSync(ledgerPath, "utf-8")), stages,
  };
}

export function loadSnapshot(now = new Date(), baseDir = dataRoot()): Snapshot {
  const today = chicagoToday(now);
  const empty = (source: "missing" | "corrupt"): Snapshot => ({ source, dir: path.join(baseDir, "data/mirror"), version: `${source}-${jsonFingerprint(baseDir)}-${today}`, generatedAt: now.toISOString(), today, ledgerUpdatedAt: null, ledger: [], stages: { ...ZERO_STAGES } });
  try { return mirrorSnapshot(baseDir, now, today) ?? empty("missing"); }
  catch { return empty("corrupt"); }
}
