# JobPipe 概览

JobPipe 是求职业务看板与确定性 Engine。业务数据在项目根下的 data/，无数据库。PIPELINE_DIR 一律指包含 data/ 的项目根；缺失或损坏的真实文件明确报错，不用样例填补。

## 职责与唯一写者

| 角色 | 允许的工作 |
| --- | --- |
| Muse / Agent | 读取真实事实；只向 data/inbox/ 提交事件、证据与约定实时信号 |
| Engine | 校验、备份、事务提交、业务 JSON / ledger / PDF 提升、Run / Receipt 与本地 Git |
| UI | 读取；用户决定和 Knowledge 请求只进入 inbox，由 Engine 执行 |
| 用户 | 在聊天中批准每个岗位的真实投递和简历选用；在控制台处理资料审批、答复和允许的删除 |

Discovery → Screening → Tailoring → Review → Apply → Ledger 是业务流程，不代表每个阶段都已发生。
Today 显示业务阶段、存量及当天统计；Activity 显示运行、等待、失败、中断及业务待办。
活动完成不等于投递确认；等待问题已答复不等于 Agent 已续跑。Engine 在线也不代表 Agent 在线。

## 本地规范入口

事件与证据以 [inbox-contract.md](inbox-contract.md) 为协议单一来源；领域约束见 [20-write-rules.md](20-write-rules.md)，业务映射见 [15-data-map.md](15-data-map.md)。实现入口是 lib/engine/daemon.ts，已实现事件与写集登记在 lib/engine/registry.yaml；有登记但 handler=null 的事件不可发送。

看板串行轮询完成后等待 2 秒，返回前台或恢复网络立即刷新；Engine 常规 poll 为 2 秒，主事件稳定窗为 1.5 秒。I/O、后台节流及任务处理可能增加延迟，不能承诺硬实时。
活跃文档只加载本目录顶层 .md；docs/archive/skill/ 保存历史，不作为当前操作规则。外部 Muse Skill 副本未自动同步。
