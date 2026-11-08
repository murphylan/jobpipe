import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * 写 data/ 下文件之前，按 20-write-rules.md 规则 8 逐个平铺备份：
 * data/.bak/<原文件名>.bak-<芝加哥时间 YYYYMMDD-HHMMSS>-<任务名>。
 * files 为空时备份 data/ 下全部顶层文件（不含 .bak 自身）；传入相对路径
 * （如 mirror/ledger.csv）时按同样规则平铺，路径中的 / 换成 -。
 * 返回备份目录路径（data/.bak）；data/ 不存在时返回 ""；失败时抛错
 * （调用方应中止写入）。
 */
function chicagoStamp(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts();
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}${get("month")}${get("day")}-${hour}${get("minute")}${get("second")}`;
}

export function backupData(baseDir: string = process.cwd(), files: string[] = [], task = "backup"): string {
  const dataDir = path.join(baseDir, "data");
  if (!existsSync(dataDir)) return "";
  const bakDir = path.join(dataDir, ".bak");
  mkdirSync(bakDir, { recursive: true });
  const stamp = chicagoStamp();
  const targets = files.length
    ? files
    : readdirSync(dataDir).filter((f) => f !== ".bak" && statSync(path.join(dataDir, f)).isFile());
  for (const rel of targets) {
    const src = path.join(dataDir, rel);
    if (!existsSync(src) || !statSync(src).isFile()) continue;
    const flat = rel.replace(/\//g, "-");
    copyFileSync(src, path.join(bakDir, `${flat}.bak-${stamp}-${task}`));
  }
  return bakDir;
}
