# 数据地图

所有写入由 Engine 执行。Muse 的发送格式、证据与路径见 [inbox-contract.md](inbox-contract.md)；业务不变量见 [20-write-rules.md](20-write-rules.md)。

## 页面事实源

| 页面 | 真实来源与含义 |
| --- | --- |
| Today | jobs.json / resume-versions.json / applications.json / mirror/ledger.csv 的共享业务投影；daily-targets.json 为计划 |
| Today 阶段次数 | committed Run 按 finishedAt 的芝加哥完成日统计 DISCOVERED / SCREENED / TAILORED / USER_DECIDED；apply 仅取当天 ledger confirmed 行 |
| Activity | activity.json 的最新真实运行投影、waiting.json、muse-live.json、业务未完成投影；历史未关联项不猜测岗位 |
| Jobs / Applications | jobs.json；applications.json 通过 jobId 关联；ledgerRowId 对应台账 id |
| Resumes | resume-versions.json、resumes.json；正式 PDF 在 resume-files/，只读已有引用 |
| Knowledge | knowledge.json 为用户知识及重读历史；quirks.json 为只读经验 |
| Skill / History / Engine | docs/skill/*.md 与 skill.json；changelog.json；engine/ 下的状态与心跳、Run / Receipt |

台账真实路径是 data/mirror/ledger.csv。所有路径相对同一项目根。缺失/损坏来源会显示空值与来源问题，不把空值当作“没有业务”。

## 阶段与事件

| 用户意图 | Muse 提交 | Engine 业务结果 |
| --- | --- | --- |
| 只找职位 | DISCOVERED，payload.job | 新 Job status=new；不更改已有岗位、不执行投递 |
| 筛选 | SCREENED | new / screening 才能更新；approved / applied 不接受筛选覆盖 |
| 定制简历 | TAILORED + inbox PDF | 新版本和正式 PDF；不修改已投版本、不等同投递批准 |
| 用户决定 | USER_DECIDED + user-approval 证据 | apply / drop / hold 的岗位决定；review 统计是该处理次数 |
| 投递确认 | APPLICATION_SUBMITTED + 真实用户批准和雇主确认 | 同一事务维护 jobs、application、confirmed ledger、changelog；派生当日统计 |
| 雇主跟进 | FOLLOWUP_RECEIVED + employer-message / employer-confirmation | 对应 ledgerRowId 的申请与台账阶段、下步动作同步 |
| 运行与等待 | AGENT_ACTIVITY / AGENT_WAITING | 运行历史和待定队列；不替代上述业务事件 |
| 每日目标 / 知识 | TARGET_SET / KNOWLEDGE_CHANGED | 目标或知识条目；没有新业务动作时不伪造阶段次数 |

## 关键不变量

- 新岗位先入库，再定制与投递；application.jobId 必须存在。
- 每次投递确认有同岗位有效 Receipt、application 和 confirmed ledger 行，日期、公司、岗位、版本一致。
- 存量与当日处理次数分开；未来跟进仍是未完成业务事项。
- 历史 daily 冻结；不得为了让指标好看而改历史数、补造成功收据或清理审计记录。
- 只执行用户要求的阶段；缺少证据或实现不支持的修改，报告限制并等待处理，不绕过 inbox。
