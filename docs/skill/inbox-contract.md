# Muse 收件箱契约

本文件是仓库内的事件协议入口；lib/engine/daemon.ts、schema.ts、registry.yaml 共同给出实际支持边界。只发送已实现 handler 的事件。RESUME_VERSION_CHANGED / RECORD_DELETED 虽有预留登记，当前不可执行。

## 路径与发布

所有路径相对包含 data/ 的项目根（PIPELINE_DIR）。Muse / Agent 只提交：

- data/inbox/<taskId>.json：不可变业务或运行事件。
- data/inbox/evidence/<name>.pdf：新 PDF 证据；普通文件、%PDF- 头、最大 25 MiB。其他任务证据写入事件 evidence，附真实来源，不伪造外部文件能力。
- data/inbox/muse-live/<jobId>.json：约定的实时覆盖槽。

UI 决定进入 data/inbox/decisions/；UI Knowledge 进入主事件 inbox。Agent 不代造用户决定，不修改正式业务、Run、Receipt、Changelog 或锁。
写完同目录临时文件后原子发布 .json / .pdf；不要把半写文件暴露给消费者，不覆盖其他内容的 taskId。Engine 只处理稳定至少 1.5 秒的主事件/决定/实时文件。

## Envelope 与幂等

```json
{
  "taskId": "discover-20261106-example-001",
  "event": "DISCOVERED",
  "createdAt": "2026-11-06T12:00:00Z",
  "payload": {"job": {"id": "example-engineer", "company": "Example", "role": "Engineer", "channel": "Other", "location": "Remote", "remote": "remote", "salaryPosted": null, "salaryAnswer": null, "matchPoints": [], "redFlags": [], "conclusion": "pending"}},
  "evidence": [{"kind": "browser-report", "text": "真实职位页来源与核实记录"}]
}
```

文件名必须等于 taskId。taskId 为 1–180 字符，以英文字母或数字开头，仅含字母、数字、点、下划线、连字符，不含连续双点；不要占用 Waiting/删除系统键前缀。createdAt 是有效 UTC instant；payload 必须为对象；evidence 可省略，存在时是 kind/text 字符串对象数组。可选 baseline 必须来自真实读取且路径安全，不构造假基线。

taskId 是一条事件的幂等键：相同内容重试沿用原键；改变 payload、证据或时间戳都应使用新键。新收据保存 inputHash，相同键内容冲突拒绝，成功收据不被拒绝事件替换。历史没有身份凭据时明确不可核验，不回填旧收据。

## 已实现业务事件

| event | payload / evidence |
| --- | --- |
| MUSE_SETTINGS_CHANGED | 仅用户通过 Settings 发起；projectRoot 为当前项目绝对路径，museBinary 为可执行文件绝对路径，expectedVersion 为非负整数；Engine 保存版本和历史。Agent 不代造用户配置决定 |
| APPLICATION_IMPORTED | 高审批：先进入 pending-approval，必须由用户通过决定入口批准后才执行；事件中的 user-approval 文本不能代替用户决定。仅用于明确授权的历史补录；jobId / ledgerRowId / resumeVersion，附 employer-confirmation 与 user-approval 证据；岗位须已投递、台账行须已确认且公司/职位/简历一致、PDF 可用，不允许重复关联；只新增申请及审计，不重新投递、不追加台账、不重写历史统计 |
| TARGET_SET | date: 芝加哥 YYYY-MM-DD；target: 非负整数 |
| DISCOVERED | job: 对象，至少 id / company / role / channel；Engine 写 status=new；其他元数据遵守 Job 契约 |
| SCREENED | jobId；conclusion: apply / drop / pending；可选 matchPoints / redFlags 数组、notes / jdKind / jdMissing 字符串；仅 new / screening |
| TAILORED | jobId / resumeVersion / file，file 必须是 inbox PDF 路径；可选 note |
| USER_DECIDED | jobId；decision: apply / drop / hold；非空 user-approval 证据 |
| APPLICATION_SUBMITTED | jobId / resumeVersion；可选 appliedAt、score、employmentType、recruiter、jdSnapshotPath、notes；必须有 employer-confirmation 与 user-approval 证据；岗位 approved、JD 完整、版本与正式 PDF 可用；岗位已有提交尝试记录时必须带 attemptId 且该尝试为 confirmed / resolved-confirmed（入账时消费，一次尝试只入账一次）；无尝试记录的岗位不要求 |
| FOLLOWUP_RECEIVED | ledgerRowId / stage；可选 lastContactDate / nextAction / nextActionDate / notes；非空 employer-message 或 employer-confirmation 证据 |
| PLAN_RECORDED | planId / jobId / runId / planVersion / resumeVersion / formUrl / fields[]；可选 activityId / approvalBasis（batch-authorization / single-approval + ref）；关键字段必须带 source（profile / knowledge / quirk / material / user-answer），Engine 解析来源并计算批准状态（approved / recorded）与 planHash；已投递/已放弃岗位拒绝；秘密字段用 valueKind=secret-action 且不得带 plannedValue |
| CHECKPOINT_RECORDED | checkpointId / jobId / runId / planRef（planId / planHash）/ type（after-upload / after-parse / on-page-change / pre-submit）/ results[]（fieldKey / expected / readback / result / basis）；上报读回值本身，Engine 对照计划做值级比对并计算 passed / failed（声称的 result 不作数）；pre-submit 必须覆盖计划全部关键字段；planHash 与当前计划不符拒绝（E_PLAN_STALE）；秘密字段不得带 readback 值 |
| ATTEMPT_RECORDED | attemptId / jobId / runId / planRef / resumeVersion / checkpointSetHash / approvalRef；点击提交前发出（写前提交），须先拿到 committed 回执才许点击；要求计划 approved、通过的 pre-submit 检查点、检查点集哈希与 Engine 当前有效集一致；同岗已有未终结尝试（recorded / uncertain / escalated）拒绝（E_ATTEMPT_OPEN，岗位级锁只在 Engine） |
| ATTEMPT_RESOLVED | attemptId / outcome（confirmed / not-submitted / uncertain / resolved-confirmed / resolved-not-submitted / escalated）；可选 evidence；confirmed 类结果必须带证据；状态迁移：recorded → confirmed / not-submitted / uncertain；uncertain → resolved-* / escalated；escalated → resolved-* |
| QUIRK_LEARNED | trigger / action；可选 id / source |
| PROFILE_CHANGED | 真实 profile 变更字段；高审批 |
| RESUME_IMPORTED | version / file（inbox PDF）；可选 jobId / note；高审批 |
| SKILL_REVISED | skillVersion 或 changelog 数组，可同时提供；只更新 skill.json 元信息，不修改活跃文档；高审批 |
| KNOWLEDGE_CHANGED | action=add：title / body / tags 字符串数组；update：id / expectedUpdatedAt / title / body / tags，Engine 归档旧条目并创建带 supersedes 的新条目，冲突或已归档时拒绝；archive：id / archived 布尔值；reread：可选 taskId；完整日志保留 |

高审批事件由 UI /api/decisions 提交 {taskId, approved, quote}，批准时 quote 非空。APPLICATION_SUBMITTED 的授权来自真实聊天 user-approval 证据，不能用控制台资料批准替代投递批准。

## Muse 任务上下文

AGENT_CONTEXT_REQUESTED payload：sessionId（本次 runId）、stage、task（非秘密文本，最多 8000 字符）、可选 jobId。Engine 将当前规则、已选择的有效 Knowledge 和岗位上下文写入 `data/agent-contexts/<taskId>.json`，并生成 Receipt。快照 content 是用于哈希的原始 JSON 字符串，digest 为其 UTF-8 SHA-256；不要跨语言重排后重新猜测摘要。

Muse 先回读 committed / verified Receipt，再读取快照；报告 digest、Knowledge 是否初始化、版本和数量。新任务重新请求，不以旧聊天记忆代替。上下文不是投递授权。

Hatch 的 AGENT_ACTIVITY 带 contextTaskId / contextDigest，runId 等于快照 sessionId。Engine 核对请求收据、哈希、任务关联及最新规则/Knowledge；不符时拒绝，不写 Activity。进度与等待状态仍遵循以下生命周期。

## Activity、Waiting 与续跑

AGENT_ACTIVITY payload：activityId、kind（screening / applying / gmail-check / recording / other）、stage（discovery / screening / tailoring / review / apply / ledger）、status（running / waiting / done / failed）、title；可选 jobId、note（最多 300 字符）、refs（Receipt taskId 数组）、startedAt / finishedAt、runId / sequence / restartOf / leaseExpiresAt。

- activityId 标识逻辑任务；每条事件使用新 taskId；同一次运行保持 runId 并递增非负整数 sequence，声明 runId 时必须有 sequence。
- 重启使用新 runId 与 restartOf；终态不能被旧会话或迟到 running 复活。同 activityId 不能更换关联岗位。
- running 默认租约五分钟；如声明 leaseExpiresAt，必须在 createdAt 后五分钟内。没有续信号则投影为待恢复，不伪造成功或失败。
- done 必须有真实有效证据。apply done 还要 jobId 与 refs，指向同岗位 committed / verified APPLICATION_SUBMITTED Receipt，且 application / confirmed ledger / 岗位和版本均匹配。

AGENT_WAITING payload：waitingId / question；可选 context 字符串数组、kind（question / approval / manual-step）、sourceActivityId / jobId。只创建 open 项。岗位可继承来源 Activity，不接受冲突。
结构化问题（可选）：category（missing-fact / conflict / approval / user-action）、factKey、fieldRef（字符串对象）、checkedSources / candidates（字符串数组）、blocksStep。同 category + factKey 的 open 项在控制台聚合展示，答复仍逐项记档。
UI 答复通过 /api/waiting：{waitingId, action: answer / park, answer, scope?}；answer 动作须非空；scope 为 once（默认）或 standing。审批类（category=approval）答复禁止 standing：事实可以复用，岗位审批不能自动复用。已答复/暂放后，后续真实运行信号才说明 Agent 已续跑；在此之前控制台显示“已答复待续跑”。
UI 删除通过 /api/deletions：{scope: activity / waiting, id}；只允许已结束活动、已答复/暂放待定项。以上决定由 Engine 幂等处理，不能视为通用业务删除能力。Engine 为决定生成 WAITING_ANSWERED / WAITING_DELETED / ACTIVITY_DELETED 类型的收据；这些是内部决定处理类型，不是 Agent 可向主 inbox 发送的业务事件。

检查点与提交尝试（阶段 C）：填写完成后在 after-upload（附件名）、after-parse（网站解析结果）、pre-submit（全部关键字段）三个时点发 CHECKPOINT_RECORDED；读回不一致（mismatch）或读不到（unreadable）都算不通过，停下修正后重跑该检查点，事实级字段被解析改写时转问题通道，不自行改了事实再提交。点击提交前先发 ATTEMPT_RECORDED 并回读 committed 回执，未 committed 不得点击；点击后按结果发 ATTEMPT_RESOLVED。结果不确定时：禁止再点一次，先按顺序核查（已有业务回执 → 申请编号 → 站点申请历史 → 确认页 → 已授权邮箱的确认邮件），查实已提交走 resolved-confirmed + 证据再以该 attemptId 提交 APPLICATION_SUBMITTED，查实未提交走 resolved-not-submitted 后才可开新尝试，仍无法判断走 escalated 交用户决定。点击后 30 分钟无确认页、无确认邮件落定即按 uncertain 处理（执行端主动上报为主，控制台对超 30 分钟仍 recorded 的尝试投影显示“结果不确定（超时）”，Engine 记录不改写）。

muse-live 覆盖槽：{jobId, state: working / waiting_user / done / failed, detail?, createdAt?}。新信号应带真实 createdAt；只用于运行展示，不替代 Activity 或业务 Receipt。Engine 成功提升后才确认消费，坏输入隔离；旧会话时间顺序有局限，优先使用 Activity runId / sequence。

## 完成证明与故障

读取 data/receipts/<taskId>.json 或 /api/receipts/<taskId>；CLI `node scripts/engine.ts receipt <taskId> --base <root>` 也是只读查询。只有 committed / verified 能证明该事件提交；pending-approval 等待用户，rejected / failed 读取错误并报告，缺收据不宣称完成。
Engine 先恢复 journal，再做幂等与守卫；成功 Receipt 存在时不重复执行业务；相同名归档保留原文件。正式 JSON 损坏时不使用默认空值覆盖。Engine 离线、锁冲突或缺失证据时停在可报告状态，不绕过文件边界。

健康心跳只把新鲜 running 视为在线；idle 是已停止，error 携带故障原因。Engine 故障不推翻已经 committed / verified 的业务 Receipt，派生状态或归档可能仍待恢复；先核对收据再判断是否需要重试。

## 推荐发布入口

运行 `node scripts/agent-events.ts emit --input <event.json> --base <root>`。输入文件包含 event、payload，可选 taskId、evidence；省略 createdAt 时由机器生成真实 UTC。明确传入的时间必须有时区且不能超过机器时钟一分钟，不能将北京时间直接标为 Z。已提交键先读收据，不制造新时间戳重放。

运行开始、切换岗位/步骤、等待、结束都应发布对应 Activity；活跃任务至少每 60 秒更新一次，同一 runId 递增 sequence。浏览器/对话任务需由实际执行 Agent 主动上报。
有实际命令时可用 `node scripts/agent-events.ts run --stage screening --title "筛选任务" -- <actual-command>`：仅在真实子进程存活时续报，退出后停止；receipt 类型的进程执行回执（source=process-exit）仅证明进程退出，不证明业务完成。apply 缺少同岗位收据证明时只报告等待。
Activity 的“最近业务处理”来自真实 committed Run + Receipt，只读展示已入账结果；不能用它推断 Agent 当前步骤或补造运行历史。

活动可选 `scope=job|batch`：单岗 scope=job 必须关联 jobId；明确的非投递批次使用 scope=batch 且不携带单个 jobId。范围在同一 activityId 内保持不变，后续信号可省略并继承；未声明范围的旧记录不按阶段猜测为批次。投递仍必须逐岗关联、取得批准与业务证明。
