# 写入边界与领域约束

## 写入纪律

Muse / Agent 只允许写 data/inbox/ 中的事件、证据及约定实时信号，详见 [inbox-contract.md](inbox-contract.md)。业务 JSON、台账、正式 PDF、Run、Receipt、Changelog 和 Engine 状态均由 Engine 管理。UI 只提交请求或用户决定，不直接改业务事实。

不通过直接修改业务文件修复运行问题。真实数据迁移、删除、覆盖或历史纠错需要独立、明确授权以及可审查的 Engine 处理；现有删除入口仅针对已结束 Activity / Waiting，不支持通用职位或台账删除。

同一个 taskId 只代表一个不可变事件；相同内容重试沿用原键，修改内容使用新键。先读 Receipt；pending、失败、未找到或不可核验都不能报告“业务已完成”。损坏正式文件停止相关处理，保留原字节并报告。

## 日期与计数

- 业务日取 America/Chicago，禁止手算北京时差；夏令时会改变偏移。时间戳保存 UTC instant，日期从该 instant 转换；历史 date-only appliedAt 按芝加哥日历日期解释。
- discovery / screening / tailoring / review 来自该业务日全部 committed Run 的 finishedAt，分别统计 DISCOVERED / SCREENED / TAILORED / USER_DECIDED。它们是业务处理次数，不是唯一岗位数、待办数或 Activity 条数。
- apply / Confirmed 同源，只取 ledger date_submitted 为当天且 submission_status=confirmed 的行；平台 submitted 不算确认。
- 新投递 application 与 ledger 的日期成对一致。历史 daily 行及已知差异冻结，不重算覆盖，不回填旧收据。

## 岗位与简历真实性

- JD 全文至少 300 字符作为领域完整性门槛；不足时记录 jdMissing：login-wall / expired / blocked / alert-only / other:说明。投递还需 jdKind=full 及真实可核验内容，不能只改标签绕过门槛。
- SCREENED 仅处理 new / screening；approved / applied 不被筛选覆写。更正已批准事项需报告，不能伪装成再次筛选。
- 新简历版本采用芝加哥日期与四位年份，如 vYYYYMMDD-<jobId>；历史 v2025… 不自动迁移。已被申请引用的版本冻结，修改应创建新版本。
- selected[jobId] 只是推荐，用户仍须在聊天确认本次选用；当前没有已实现的通用版本切换事件，不发送占位事件名。
- ledgerRowId 新写使用台账 id 列原值字符串。旧派生 ID 和已知漂移保持原样，读取兼容不代表已自动修复。

## 状态词表

application stage：todo / applied / replied / screen / interview / offer / rejected / rejected_after_contact / withdrawn / ghosted。
终态：offer / rejected / rejected_after_contact / withdrawn / ghosted。screen 算回复、不算面试、不是终态；withdrawn 不算回复/面试。
Today 业务阶段来自业务记录；Activity 的 done 只证明本次运行结束，有待跟进时业务仍未完成。运行信号过期应显示待恢复，不伪造失败或完成。
