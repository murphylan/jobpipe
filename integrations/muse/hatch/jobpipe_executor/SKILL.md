# JobPipe 求职执行

工程在用户 Mac：Settings 中确认的工程路径（不是本机目录）。用本会话实际可用的 Mac 设备文件通道，先读其连接器说明，不编造工具名、shell 或挂载方式。业务规则以工程内 `AGENTS.md`、`docs/skill/inbox-contract.md` 和阶段规范为准，不另存副本。

## 取上下文（每次运行必做）

- 任务文本（不含秘密）写入本机文件，用本 Skill 的 `scripts/jobpipe.py request --stage <stage> [--job-id <id>] --task-file <f> --out <f>` 构建请求，经 muse.exec 实跑，占位符不作参数。
- 经 Mac 文件通道写 `data/inbox/<taskId>.json.tmp`，目标不存在才改名为 `.json`；已有同名先比对，不覆盖、不换编号重试。
- 回读 `data/receipts/<taskId>.json`；仅 committed/verified 才读 `data/agent-contexts/<taskId>.json`，请求、回执、快照复制回本机核对。Engine 离线、拒绝或无上下文则停，不宣称已加载。
- `jobpipe.py load --snapshot … --receipt … --request … --state <新文件> --workspace <project-root> --full` 实读全文；首条回复报 digest、Knowledge 是否初始化、版本与条目数，并复述本次相关约定。不凭摘要或记忆声称读过规则。

## 上报真实进展

- 开始前用 `jobpipe.py report` 发 running 并确认回执；切换岗位或步骤时更新；进展来自真实工具活动，不发假心跳。
- 需用户答复：report 置 waiting 并另发 AGENT_WAITING（同 activityId），问题留在 Activity，停手等真实答复。
- 续跑前重读原 Activity、待定项与回执，读到 Engine 记录的答复后用 `--resume-answer` 恢复；中断或新会话用新上下文与新 runId：load 时 `--activity-id` 关联原活动，report 用 `--restart-of` 声明原运行，不复用终态运行。
- 结束前取真实业务证据并核对业务回执；done 必带 `--proof-file`，其中 receipts 须是从 Mac 回读的业务收据。文件送达不等于入账，工具退出不等于业务完成。
- 点真实提交前按 jobId 重取 apply 上下文，读 preflight 并确认用户对本岗位的真实批准；缺一即停等，上下文不等于授权。

## 表单计划与结构化等待（Apply）

- 填表前先观察表单全部字段，手写 PLAN_RECORDED 信封经文件通道发布（taskId 形如 muse-plan-<日期>-<岗位键>），回读 committed 回执与 summary 中的 planHash；计划未记 approved（关键来源未全解析或缺 approvalBasis）不得开始填写。
- 关键答案缺来源：先发结构化 AGENT_WAITING（category、factKey、checkedSources、candidates、blocksStep），report 置 waiting 停手；答复落账后以 user-answer 来源补记新版计划再续跑，续跑上报引用答复的 waitingId。
- 计划外新关键字段同样先问后填；关键答案变更必须升 planVersion。秘密值不进计划（secret-action 只标动作）。

## 读回检查点与提交保护（Apply）

- 上传后、网站解析后、提交前三个时点发 CHECKPOINT_RECORDED，上报读回值本身对照计划比对；不一致或读不到就停下修正并重跑该检查点，事实级字段被解析改写先走问题通道。检查点未全通过不得进入提交。
- 点击提交前先发 ATTEMPT_RECORDED 并回读 committed 回执，未 committed 不得点击；点击后立即发 ATTEMPT_RESOLVED 落定结果（confirmed 必须带确认页/确认邮件证据）。
- 结果不确定（空白页、超时）：禁止再点一次。先按顺序核查（业务回执 → 申请编号 → 站点申请历史 → 确认页 → 已授权邮箱确认邮件），查实后 resolved-confirmed / resolved-not-submitted，仍不明 escalated 交用户决定；30 分钟未落定按不确定处理。
- APPLICATION_SUBMITTED 本岗走过尝试流程时必带 attemptId（confirmed / resolved-confirmed 的那次），入账即消费，不得复用。

## 保存约定与红线

- 用户确认的约定经 KNOWLEDGE_CHANGED 保存（tag `agent-context`），见 committed 回执才说已保存；密码与令牌不写入 Knowledge、任务、Skill、Activity。
- 每个新任务重取最新上下文；规则或 Knowledge 变化即重载。MEMORY.md 只存工程位置与本 Skill 指针，不存业务规则副本。
- 上报失败或不可观测时报告并停；不直接修改 Mac 的业务 JSON、正式材料、回执或 Engine 状态。

- 在非投递批次首次上报时显式传入 `report --scope batch`，单岗任务使用 `--scope job` 并绑定岗位。后续信号可继承范围，不把缺少 jobId 的单岗活动伪装为批次，投递不能使用批次范围替代逐岗证明。
