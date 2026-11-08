# 每日清单

协议见 [inbox-contract.md](inbox-contract.md)，统计口径见 [20-write-rules.md](20-write-rules.md)。

## 开始任务

- [ ] 读取真实数据及来源问题，核对芝加哥业务日、已有岗位与版本，避免重复业务。
- [ ] 读取 Engine 心跳与错误；离线或故障时报告“尚未执行”，可以明确标为排队的 inbox 请求，但不能绕过 Engine。
- [ ] 用户要求调整目标时发送 TARGET_SET；没有调整要求时沿用计划，缺省显示 20。
- [ ] 发送 AGENT_ACTIVITY running，明确 activityId、jobId（存在关联时）、runId 与 sequence；查看其 Receipt / Activity 可见性。

## 进行与结束

- [ ] 运行中发送同一 runId 的递增 sequence 真实进度，等待用户时发送 AGENT_WAITING 并保留等待语义。
- [ ] 发送实际发生的业务事件，等待 committed / verified Receipt；投递需核对同岗位 application 和 confirmed ledger。
- [ ] 发送 AGENT_ACTIVITY done / failed 与真实证据。apply done 必须引用同岗位有效 APPLICATION_SUBMITTED Receipt。
- [ ] 只读核对当天 committed Run 和 ledger confirmed 统计；发现差异列出具体记录与来源，历史保持不变。
- [ ] 报告成功、排队、拒绝、待恢复与无法核验事项。备份、统计、版本、Changelog 由 Engine 处理，无需另造“收工记录”。

简历不自动重生成；计划数不自行调整；真实投递、外发邮件与资料高审批事件按用户授权执行。
