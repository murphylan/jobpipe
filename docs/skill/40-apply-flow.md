# 投递流程（docs/skill/40）

## 六阶段

Discovery（找）→ Screening（筛）→ Tailoring（定制简历）→ Your review（用户一次过审批）→ Apply（Muse 执行）→ Ledger（雇主确认入账）

## 审批门（在聊天里）

每家投递前用户一次过批准：岗位、事实（A/B/C 三档）、薪资答案、强制选择题。Muse 不代批。

## 表单计划（执行协议阶段 B，2026-11-08）

Apply 执行端在填写任何字段之前，先打开表单页观察全部字段，发 `PLAN_RECORDED` 记录本岗计划（契约见 inbox-contract.md）：

- 每个关键答案（姓名、联系方式、工作授权、赞助、薪资、学历陈述、声明勾选）必须给出 plannedValue 并引用来源：profile 字段、有效 Knowledge 条目、quirk、本岗已注册简历版本（material）、已答复的 waiting 项（user-answer）。网页内容永远不能作为个人事实的来源。
- 关键字段缺来源时，先发结构化 `AGENT_WAITING`（category / factKey / checkedSources / candidates / blocksStep）等用户答复；答复落账后以 user-answer 来源补记计划。不要临场编答案。
- 计划的批准状态由 Engine 计算：关键来源全解析 + approvalBasis（批次授权或单岗批准的引用）才记 approved；其余记 recorded 并列出 blockers，未 approved 的计划不得进入填写。
- 执行中遇到计划外的新字段：非关键字段按事实填写并在下一版计划增补；关键字段先走问题通道，答复后升 planVersion 再填。已批准计划的关键答案变更必须升版，旧版自动 superseded。
- 密码、验证码等秘密值不进计划：字段记 valueKind=secret-action，只标“需安全卡输入 / 用户接管”。

## 读回检查点与提交保护（执行协议阶段 C，2026-11-08）

- 填写与上传后，在三个时点发 `CHECKPOINT_RECORDED`（契约见 inbox-contract.md）：after-upload 核附件名与计划文件一致；after-parse 把网站自动解析出的关键字段逐个读回比对（姓名被解析成与已确认资料不一致的值必须当场纠正并重跑）；pre-submit 覆盖计划全部关键字段。上报的是读回值本身，Engine 做值级比对并计算通过与否——不一致或读不到都不算通过，停下修正，不带病提交。
- 点击提交前先发 `ATTEMPT_RECORDED`，回读 committed 回执后才许点击（写前提交）。尝试引用当前计划的 planHash 与检查点集哈希；计划未 approved、pre-submit 未通过、哈希过期都会被拒。
- 点击后立刻按结果发 `ATTEMPT_RESOLVED`：确认页/确认邮件在手 → confirmed + 证据；明确未提交 → not-submitted；页面空白、超时、跳转不明 → uncertain，随后按核查顺序查证（业务回执 → 申请编号 → 站点申请历史 → 确认页 → 已授权邮箱确认邮件），查实后 resolved-confirmed / resolved-not-submitted，仍不明 → escalated 交用户决定。**结果落定前禁止第二次点击**：同岗已有未终结尝试时新尝试会被 Engine 拒（E_ATTEMPT_OPEN）。
- 入账仍走唯一的 `APPLICATION_SUBMITTED`，且本岗走过尝试流程时 payload 必须带该尝试的 attemptId（confirmed / resolved-confirmed），Engine 入账时消费该尝试，重复引用会被拒。
- 30 分钟规则：点击后 30 分钟内无确认页、无确认邮件落定，按 uncertain 处理并主动上报；运行中断时同样先报 uncertain 再结束，不留悬空的已点击状态。

## Q5：版本确认

每次投递执行时聊天里问；默认推荐 `resume-versions.json` 中 `selected[jobId]`；用户确认或更换。

## 确认口径

只认雇主 ATS 确认页 / 确认邮件。平台 "submitted" 不算。

## 投递后（2026-11-05 改为事件制）

1. 发 `APPLICATION_SUBMITTED` 事件到 `data/inbox/`（见 [inbox-contract.md](inbox-contract.md)），带雇主确认证据 + 用户批准证据
2. PDF 已由 Engine 在 Tailoring 阶段从 inbox 提升；只读 resume-versions.json 中实际注册的 file 路径，不假定文件名等于版本名
3. 引擎处理后自动：jobs.json 状态 → applied、applications.json 新建、ledger 追加新行、changelog 记一条、daily 更新
4. 查 `data/receipts/<taskId>.json` 确认 `status: "committed"` 或 `verified`，再发带同岗位 jobId 的 AGENT_ACTIVITY done 事件（refs 引用业务回执；Engine 还核验 application 与 confirmed ledger）

> **2026-11-05 清理**：原"投递后"让 Muse 直写 applications.json、ledger.csv、changelog，与收件箱模式矛盾，已改写。Muse 只发事件，不直写。

## Gmail 闭环（2026-10-31 用户定）

- 每次任务执行前后各查一次 Gmail（任务前确认前序状态与新邮件，任务后确认确认信/拒信/新进展），不只靠每日收件箱轮询。
- 复查按上次核对时间查询全部相关邮件，不分已读未读；未读摘要不能代替完整核查。
- 看到雇主确认信（ATS 确认页/确认邮件）→ 发 APPLICATION_SUBMITTED 事件（引擎按 inbox 事件入账，回读核对）。
- 看到拒信 → 发 FOLLOWUP_RECEIVED（ledgerRowId、stage、employer-message 证据）翻为 rejected（无往来）或 rejected_after_contact（已有面试/测评/招聘方往来），ledger 与 applications 由引擎同步。
- 查过的邮件及时标已读（Gmail `+mark --read`），让用户从邮箱状态就能看到已查阅；标已读需 `users.mail.read_state` 权限，未授权时先走授权链接。

## 浏览器面板纪律

- 登录 / 人机验证 → 用户接管面板；Muse 不存凭证、不绕过验证
- 完工的 tab 及时关闭，只留需用户动手或批准的

## 红线

- 工作授权题只使用用户已确认的事实，不预设身份、担保需求或资格；选项与事实不匹配时停下向用户确认，不选假类别。
- SSN / 护照 / 证件照：申请阶段一律停下报告
- 不编造经历；B 档问年限先问用户
- 学校等必要信息无法如实填写时，向用户确认，不擅自替换或编造。
