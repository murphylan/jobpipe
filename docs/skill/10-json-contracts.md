# JSON 契约（docs/skill/10）

> 业务结构说明；实际验证见 lib/engine/schema.ts，事件协议见 [inbox-contract.md](inbox-contract.md)。字段写入由 Engine 执行。扩展字段保留，本文不授权直写。

```ts
// data/profile.json —— 基础信息（R5 的重生成基准）
type Profile = {
  version: number; updatedAt: string;
  legalFirstName: string; legalLastName: string; preferredName: string;
  email: string; phone: string;
  address: { line1: string; city: string; state: string; zip: string; country: string };
  linkedin: string; github: string;
  workAuth: { status: string; needsSponsorship: boolean; expiry: string };
  salary: { remoteFloor: number; onsiteFloor: number };
  noticePeriod: string; nonCompete: boolean;
};

// data/jobs.json —— 职位库（R4，引擎按 inbox 事件导入）
type Job = {
  id: string; // slug，如 porter-company-software-engineer
  company: string; role: string;
  url: string; // 职位原帖链接（2026-10-31 统一，原 sourceUrl 迁移至此）
  description?: string; // JD 全文纯文本，≥300 字符算抓到（2026-10-31 用户定）；抓不到写 jdMissing
  jdMissing?: string; // 原因：login-wall / expired / blocked / alert-only / other:<说明>
  channel: "LinkedIn" | "Indeed" | "Dice" | "Other";
  location: string; remote: "remote" | "hybrid" | "onsite";
  salaryPosted: string | null; salaryAnswer: number | null;
  matchPoints: string[]; redFlags: string[];
  conclusion: "apply" | "drop" | "pending";
  status: "new" | "screening" | "approved" | "applied" | "dropped";
  version: number; updatedAt: string;
  // —— 合作模式识别字段（2026-10-31 统一机会模式新增，全部可选） ——
  engagementType?: "W2" | "1099" | "C2C" | "Full-time" | "Unknown";
  companyContractAllowed?: "Yes" | "No" | "Unknown";  // 是否接受公司签约
  vendorAllowed?: "Yes" | "No" | "Unknown";           // 是否接受供应商
  subcontractingAllowed?: "Yes" | "No" | "Unknown";  // 是否允许分包/派人
  assignmentModel?: "company-assignment" | "personal-hire" | "Unknown";
  contractBudget?: string | null;   // 合同预算（如披露）
  verificationEvidence?: string;    // 判断依据 + 原始来源（非 Unknown 时必填）
};
type JobsFile = { version: number; updatedAt: string; jobs: Job[] };

// data/resumes.json —— 简历构件库（R1，第二批）
type ResumeBlock = {
  id: string; kind: "skill" | "project" | "summary" | "experience" | "education";
  title: string; body: string; source: string; // source = 来自哪份历史简历
  version: number; updatedAt: string;
};
type ResumesFile = { version: number; updatedAt: string; blocks: ResumeBlock[] };

// data/resume-versions.json —— 简历版本（R5）
type ResumeVersion = {
  version: string; // 推荐 vYYYYMMDD-<jobId>，旧版本名保持不变
  jobId: string; file: string; // 新文件由 Engine 提升为 data/resume-files/<taskId>.pdf，旧引用保留
  createdAt: string; note: string;
};
type ResumeVersionsFile = {
  version: number; updatedAt: string;
  versions: ResumeVersion[];
  selected: Record<string, string>; // jobId -> version（Q5 默认推荐）
};

// data/quirks.json —— 投递知识库（R2，第二批）
type Quirk = {
  id: string; trigger: string; action: string; source: string;
  version: number; updatedAt: string;
};
type QuirksFile = { version: number; updatedAt: string; quirks: Quirk[] };

// data/applications.json —— 投递跟踪（R3，2026-10-31 改用 ledgerRowId 关联）
type AppStage = "todo" | "applied" | "replied" | "screen" | "interview" | "offer" | "rejected" | "rejected_after_contact" | "withdrawn" | "ghosted"; // 2026-10-31 用户定：新增 screen / rejected_after_contact / withdrawn；代码已同步（2026-10-31 测试通过）
type Application = {
  id: string; // Engine 生成的稳定 ID，当前为 <芝加哥日期>-<jobId>，旧 ID 保留
  jobId: string;
  ledgerRowId: string | null; // 关联 ledger.csv 行；未确认投递时为 null。2026-10-31 用户定：新写用 ledger id 列原值字符串（如 "10"）；旧内容派生 ID 冻结不动，解析双兼容（纯数字直接当 id，旧长 ID 取最后一段数字）
  resumeVersion: string;
  source: string; collectedAt: string;
  appliedAt: string | null; employerConfirmed: boolean;
  stage: AppStage;
  nextAction: string | null; nextActionDue: string | null;
  interviewAt: string | null; notes: string;
  version: number; updatedAt: string;
};
type ApplicationsFile = { version: number; updatedAt: string; applications: Application[] };

// data/skill.json —— Skill 元信息（R6）
type SkillFile = {
  version: number; updatedAt: string;
  skillVersion: string; changelog: string[]; // 迭代优化点
  dependencies: string[]; // ledger.csv 路径、funnel.py、浏览器面板…
};

// data/daily-targets.json —— 每日计划数（R7）
type DailyTargets = { version: number; updatedAt: string; targets: Record<string, number> }; // date -> 目标数，默认 20

// data/daily.json —— 每日阶段计数（stage rail 数据源，daily 实时制）
type DailyFile = {
  version: number; updatedAt: string;
  days: Record<string, { discovery: number; screening: number; tailoring: number; review: number; apply: number }>;
};

// data/changelog.json —— 全局版本记录（append-only，只追加）
type ChangelogEntry = { at: string; action: string; target: string; version: number; note: string };
type ChangelogFile = { entries: ChangelogEntry[] };
```

约束：台账真实路径 data/mirror/ledger.csv；投递事务追加新行，真实跟进事件只更新指定申请/台账字段。旧格式、历史日期和已知差异不擅自迁移。所有业务结构由 Engine 提交，不因展示需要改写历史。

Activity / Waiting / Knowledge 的实际 schema 与生命周期见 [inbox-contract.md](inbox-contract.md)。daily 非 apply 计数来自 committed Run 的芝加哥 finishedAt 日；apply 来自 ledger confirmed。历史 days 冻结。
