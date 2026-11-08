# 任务执行协议

## 执行前说明

先说明任务目标、范围、读取事实、拟提交的事件与证据、审批要求、验证方式和失败后的报告方式。TASK ID 用于报告；每条 inbox 事件另有唯一 taskId，同一逻辑任务使用 activityId，多次尝试使用不同 runId。具体格式以 [inbox-contract.md](inbox-contract.md) 为准。

## 阶段隔离

| 阶段 | 业务事件 | 禁止 |
| --- | --- | --- |
| Discovery | DISCOVERED | 改已有岗位、绕过审批投递 |
| Screening | SCREENED | 覆盖 approved / applied，伪造完整 JD |
| Tailoring | TAILORED + inbox PDF | 覆盖已投递版本或正式 PDF |
| Review | USER_DECIDED；需答复时 AGENT_WAITING | 把回答当作 Agent 已续跑或投递批准 |
| Apply | APPLICATION_SUBMITTED + 批准/雇主确认 | submitted 当 confirmed，未批准先投 |
| Follow-up | FOLLOWUP_RECEIVED | 仅用 Activity 描述代替真实申请/账本更新 |

运行开始、等待、结束另发 AGENT_ACTIVITY；它不能替代业务事件。可关联岗位时携带正确 jobId，历史未关联不按标题补造。

## 边界与保护

- 日常求职任务只读业务文件，只写 inbox；不启动新的开发批次，不修改代码、JSON schema、正式 PDF 或活跃 Skill。代码与规则修复属于用户单独授权的开发任务。
- 不删除或追溯更改真实历史；雇主确实发生的新跟进通过 FOLLOWUP_RECEIVED 更新当前申请/台账相关字段，保留证据和审计，不伪装成历史纠错。
- 用户批准每个岗位、事实档位、薪资答案、强制题与简历后才执行真实投递。资料高审批事件通过控制台决定；历史删除/迁移不能被普通批准决定替代。
- 日期/统计/终态/冻结规则集中在 [20-write-rules.md](20-write-rules.md)，不复制另一套口径。恢复由 Engine journal / Receipt 负责，Muse 不执行 checkout 或备份恢复来覆盖真实业务。

## 结束报告

列出 activityId / runId、已发送 taskId、Receipt 状态、已核验业务变化、用户尚需处理事项、失败或待恢复原因，以及不能核验的限制。排队不算完成；不替 Engine 造 Receipt / Run / Changelog。

## 合作模式核实

识别 C2C / Corp-to-Corp / 1099 / Independent Contractor / W2 / contract / vendor / subcontract，但关键词不等于结论。

- 只有 Contract：engagementType=Unknown，companyContractAllowed=Unknown。
- 明确 C2C / Corp-to-Corp：以 JD 原文作为 verificationEvidence；明确 W2 only / No C2C / No third parties：公司签约为 No。
- 1099 需进一步确认是否允许公司；无法确认保持 Unknown，按个人雇佣处理或 HOLD。
- verificationEvidence 为空时，除 engagementType 外的合作字段保持 Unknown；companyContractAllowed 非 Yes 时不得以 任何公司名义接触招聘方，不虚构合作意向。
- 外发核实需用户明确批准，模板见 [70-engagement-verification.md](70-engagement-verification.md)。新岗位证据可随 DISCOVERED.job 提交；现有 SCREENED 只更新其支持字段，核实细节放 notes，不能宣称未支持的专用字段已入库。已批准岗位需要更正时先报告限制。
