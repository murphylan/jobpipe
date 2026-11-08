#!/usr/bin/env node
// 校验 data/ 下 JSON 的 schema、孤儿 application、daily 对账。
// 用法: node scripts/validate-data.mjs [baseDir]
// 四态: REAL / SAMPLE / MISSING / CORRUPT（2026-10-31）
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const baseDir = process.argv[2] || process.cwd();
const dataDir = path.join(baseDir, "data");
let errors = 0;
const err = (msg) => { errors++; console.error("  [X] " + msg); };
const ok = (msg) => console.log("  [OK] " + msg);
const warn = (msg) => console.log("  [!] " + msg);

// America/Chicago 今日日期（2026-10-31 修：原用 UTC）
function chicagoToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// 带来源标记的 JSON 加载
function loadJsonWithSource(rel) {
  const realPath = path.join(dataDir, rel);
  const samplePath = path.join(dataDir, "sample", rel);
  if (existsSync(realPath)) {
    try {
      return { data: JSON.parse(readFileSync(realPath, "utf8")), source: "REAL" };
    } catch (e) {
      err(`${rel}: 真实文件损坏 CORRUPT: ${e.message}`);
      return { source: "CORRUPT" };
    }
  }
  if (existsSync(samplePath)) {
    try {
      return { data: JSON.parse(readFileSync(samplePath, "utf8")), source: "SAMPLE" };
    } catch (e) {
      err(`sample/${rel}: 示例文件损坏: ${e.message}`);
      return { source: "CORRUPT" };
    }
  }
  return { source: "MISSING" };
}

// CSV 解析（处理引号内逗号，2026-10-31 修：原用 naive split）
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c !== "\r") field += c;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

console.log("== schema 检查 ==");
const jobs = loadJsonWithSource("jobs.json");
console.log(`  jobs.json 来源: ${jobs.source}`);
if (jobs.source === "REAL" || jobs.source === "SAMPLE") {
  if (jobs.source === "SAMPLE") warn("jobs.json 使用示例数据，非真实数据");
  if (!Array.isArray(jobs.data.jobs)) err("jobs.json: 缺少 jobs 数组");
  else {
    const ids = new Set();
    for (const j of jobs.data.jobs) {
      if (!j.id) err("jobs.json: 有职位缺少 id");
      if (ids.has(j.id)) err(`jobs.json: 重复 id ${j.id}`);
      ids.add(j.id);
      if (!["new","screening","approved","applied","dropped"].includes(j.status))
        err(`jobs.json ${j.id}: 非法 status ${j.status}`);
    }
    ok(`jobs.json: ${jobs.data.jobs.length} 个职位，id 唯一`);
  }
} else if (jobs.source === "MISSING") {
  warn("jobs.json 缺失 MISSING");
}

console.log("== 孤儿 application 检查 ==");
// 2026-10-31 修 DEFECT-2：优先真实文件，缺失时报 MISSING 不静默用 sample
const appsReal = path.join(dataDir, "applications.json");
let apps;
if (existsSync(appsReal)) {
  apps = loadJsonWithSource("applications.json");
  console.log(`  applications.json 来源: ${apps.source}`);
} else {
  warn("data/applications.json 缺失 MISSING：真实投递数据尚未迁移，不回退 sample");
  apps = { source: "MISSING" };
}
if ((apps.source === "REAL" || apps.source === "SAMPLE") && jobs.data && Array.isArray(jobs.data.jobs)) {
  const jobIds = new Set(jobs.data.jobs.map((j) => j.id));
  const orphans = (apps.data.applications || []).filter((a) => !jobIds.has(a.jobId));
  if (orphans.length) err(`${orphans.length} 个孤儿 application: ${orphans.map((a) => a.jobId).join(", ")}`);
  else ok("无孤儿 application");
  // application id 唯一性
  const appIds = new Set();
  for (const a of (apps.data.applications || [])) {
    if (appIds.has(a.id)) err(`applications: 重复 id ${a.id}`);
    appIds.add(a.id);
  }
  if (appIds.size) ok(`applications: ${appIds.size} 条记录，id 唯一`);
}

console.log("== ledger 对账 ==");
const mirrorLedger = path.join(dataDir, "mirror/ledger.csv");
const sampleLedger = path.join(dataDir, "sample/ledger.csv");
let ledgerPath = null, ledgerSource = "MISSING";
if (existsSync(mirrorLedger)) { ledgerPath = mirrorLedger; ledgerSource = "REAL"; }
else if (existsSync(sampleLedger)) { ledgerPath = sampleLedger; ledgerSource = "SAMPLE"; }
console.log(`  ledger.csv 来源: ${ledgerSource}`);
if (ledgerPath) {
  const rows = parseCsv(readFileSync(ledgerPath, "utf8").trim());
  const header = rows[0];
  const ci = (n) => header.indexOf(n);
  const today = chicagoToday();
  console.log(`  对账日期 (America/Chicago): ${today}`);
  let confirmedToday = 0;
  for (const cols of rows.slice(1)) {
    if (cols[ci("date_submitted")] === today && cols[ci("submission_status")] === "confirmed") confirmedToday++;
  }
  const daily = loadJsonWithSource("daily.json");
  if (daily.data && daily.data.days && daily.data.days[today]) {
    const applyCount = daily.data.days[today].apply || 0;
    if (applyCount !== confirmedToday)
      err(`daily.json apply=${applyCount} 与 ledger 当日 confirmed=${confirmedToday} 不一致（需人工核对，见 2026-10-31 决策）`);
    else ok(`daily.apply=${applyCount} 与 ledger 一致`);
  } else {
    ok(`ledger 当日 confirmed=${confirmedToday}（daily.json 无今日记录）`);
  }
} else {
  warn("无 ledger.csv，跳过对账");
}

console.log(errors ? `\n${errors} 个问题` : "\n全部通过");
process.exit(errors ? 1 : 0);
