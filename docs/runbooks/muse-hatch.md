# Hatch Muse 操作手册

产品说明统一见 [JobPipe 产品说明书](../product-manual.md)。当前使用 Muse 和现有 JobPipe Engine，通过设备文件通道交换事件，不需要额外协调服务或数据库。

## 首次接入

1. 打开 Settings，复制“Hatch Muse 接入指令”发送给实际 Muse。
2. Muse 从 Mac 工程 `integrations/muse/hatch/jobpipe_executor/` 读取 `SKILL.md`、`skill.yaml`、`scripts/jobpipe.py`，安装在它自己的 `~/workspace/custom-skills/jobpipe_executor/`。
3. Muse 先搜索已有 Skill，更新等价入口，避免重复。仅在其 `~/AGENTS.md` 中补充项目路径和入口指针，保留原内容，不复制业务规则。
4. Muse 应回报实际安装位置、技能可发现性和帮助检查结果。工程接入包存在不表示已安装，Settings 中的历史确认也不表示当前正在工作。

本工程工具不能直接访问实际 Hatch 文件系统，因此不会声称已替用户安装 Skill。该端的安装和真实运行需由 Muse 执行并验证。Muse 的本地应用和它的 Linux 执行环境不是同一个文件系统，Mac 路径不能直接用于 VM shell。

## 任务开始

Muse 在 VM 用 Python helper 生成 AGENT_CONTEXT_REQUESTED，经 Mac 设备文件能力写入 `data/inbox/<taskId>.json.tmp`，再以不覆盖既有文件的方式改名。Engine 成功处理后，读取：

- `data/receipts/<taskId>.json`
- `data/agent-contexts/<taskId>.json`

将请求、快照、Receipt 复制回 VM，用 helper 的 load 校验完整性和任务关联，读取完整规则与有效 Knowledge。首条回复报告 digest、是否初始化、版本和条目数。拿不到 committed / verified Receipt 时不开始业务。

helper 的命令与参数：

```sh
python3 ~/workspace/custom-skills/jobpipe_executor/scripts/jobpipe.py --help
python3 ~/workspace/custom-skills/jobpipe_executor/scripts/jobpipe.py request --help
python3 ~/workspace/custom-skills/jobpipe_executor/scripts/jobpipe.py load --help
python3 ~/workspace/custom-skills/jobpipe_executor/scripts/jobpipe.py report --help
```

这些命令在 Muse 的执行环境中运行，输出文件只是待传输事件，不代表已经排队或入账。设备文件工具的具体调用方式，以实际会话中可用的连接器说明为准，不假设存在 Mac shell。

Mac 用户也可手动预览或准备上下文请求：

```sh
npm run muse -- --stage screening --task-file /path/to/task.md
npm run muse -- --stage screening --task-file /path/to/task.md --queue
```

第一条只输出元数据；第二条才提交上下文请求。两者都不启动 Muse 或 Engine。日常使用应由 Muse 经文件通道自行请求，不需要用户每次手动执行 Mac 命令。

## 进度与恢复

helper 持久化本次 runId、activityId、sequence，生成 running / waiting / failed / done 事件。每次真实步骤转换时上报；传输失败重发原文件，不生成新编号。运行信号带 contextTaskId / contextDigest，Engine 核对成功的上下文请求、运行身份、规则与 Knowledge 版本。

需要用户介入时发送 waiting，并按 [inbox 契约](../skill/inbox-contract.md) 发送关联的 AGENT_WAITING。停止续报。读取 Engine 已保存的匹配答复后才用 `--resume-answer` 继续。新会话或中断后使用新的上下文、新 runId，加载原 Activity 和 Receipt；用同一 activityId 与 `--restart-of` 显式重启，不盲目重投。

done 需要从 Mac 复制的真实业务 Receipts，放在 proof-file 的 receipts 数组中；它只提供引用，最终业务完成仍由 Engine 验证。上下文请求不授予投递权限。不要生成假心跳维持在线，不假设 Hatch 支持会话/工具拦截钩子。

## 长期约定

用户确认的账号方法、注册偏好和凭证管理器引用通过 KNOWLEDGE_CHANGED 提交，并标记 agent-context。Engine 收据成功后才能说已保存。每次任务重新加载；修改或归档后旧上下文的运行信号会被拒绝，需要请求新快照。秘密不进入普通知识、Skill 或日志。

## 边界

- 看板和 Engine 仍是原来的两个本地服务。真实 Engine 由用户启动；开发测试只运行临时 fixture。
- 没有常驻远程调度器，没有新增 Node 或 Python 项目依赖。helper 仅使用 Python 标准库。
- 原有 Muse Code CLI 插件和启动器保留为可选能力，命令为 `npm run muse:cli`；它不是 Hatch，不能替代上述安装和文件通道验证。
