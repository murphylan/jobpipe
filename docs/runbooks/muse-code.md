# Muse Code CLI 操作手册

本手册仅适用于本机 Muse Code CLI，不代表 Hatch Muse 已接入。产品说明统一在 [JobPipe 产品说明书](../product-manual.md) 维护；当前执行端为 Hatch Muse，参见 [Hatch 操作手册](muse-hatch.md)。

## 配置和运行

要求 Node 能直接执行 TypeScript（与现有 Engine 启动方式相同），Muse 1.4.14 已验证配置格式。先验证本地插件；安装需从已信任的 Muse 工作区执行，否则原生 CLI 会拒绝项目本地来源。不要关闭安全控制来绕过拒绝。安装后审查并批准钩子：

```sh
muse plugins validate integrations/muse/jobpipe-observer --json
muse plugins install integrations/muse/jobpipe-observer --scope project --json
muse plugins approve jobpipe-observer --json
```

本机 Muse 即使接收 `--scope project` 也会写用户插件 store；不要据此宣称隔离在项目配置文件中。Muse 会过滤 hook 继承的环境变量。插件使用 hook stdin 的 cwd 和真实父进程 PID，读取 `data/inbox/.runtime/muse-<PID>.json` 中的本次 run、上下文和源码根映射；没有该映射就立即退出，不向其他项目或未接入的 Muse 会话上报。启动器在真实子进程 spawn 后创建映射、退出后移除。

任务文本不含凭证。先预览再按需启动：

```sh
npm run muse:cli -- --stage screening --task-file /path/to/task.md --preview
npm run muse:cli -- --stage screening --task-file /path/to/task.md --trust-workspace
```

可用 `--job-id <真实岗位ID>` 限定业务对象，`--muse-bin <binary>` 指定本机二进制。预览不启动会话、写 inbox 或输出记忆正文。启动器显式检查插件授权，通过后生成权限为 0600 的临时上下文文件，真实子进程退出后删除。

现有 Muse 会话不会自动接管；此入口用于新运行。看板和 Engine 守护进程仍按原方式运行。测试不得启动真实 daemon 或往真实 inbox 注入事件。

## 上下文和记忆

上下文包括项目 AGENTS.md、inbox 协议、任务、阶段、Knowledge 版本与选中的有效条目、quirks 版本和规则、指定岗位的业务阶段及恢复记录引用。损坏数据、缺失岗位或规则会阻止启动，不使用 Sample。摘要标识传入的精确快照；要求模型回报摘要，但摘要本身不证明模型正确理解了规则。

Knowledge 仅加载未归档、带 `agent-context` 标签且不带 secret/credential/password 标签的条目。账号创建方式、凭证管理器引用等需通过既有 Knowledge/inbox 流程保存并由 Engine 提交。没有标记的历史条目不会自动导出。字符串敏感字段检测只是补充过滤，不是可靠的通用秘密识别器，因此不得把秘密存入这些条目。profile 和工具原始输入输出不进入自动导出。

聊天内容不会自动成为业务事实或长期记忆；新增或修改偏好仍需明确保存。旧条目用归档保留历史，新运行重新生成上下文。投递前必须走既有审批与 Engine preflight，启动快照不授予投递权限。

## 实时信号的语义

真实进程启动、存活、退出由 wrapper 上报；钩子运行时报告会话或工具观察。共享 runId/sequence 保证提交顺序，稳定工具调用 ID 防止重复事件；状态文件置于 `data/inbox/.runtime/`，业务 JSON 只由 Engine 写。

PostToolUseFailure 表示一次工具失败，允许 Muse 继续恢复，不自动把整个业务任务标为失败。Stop/SessionEnd 进入等待确认；投递进程正常退出但没有同岗位业务证明，也只能等待。强杀可能没有终止事件，现有 Activity 租约负责显示待恢复。锁在进程强杀后可能残留；新启动使用新 runId，禁止删除历史记录伪装恢复。

原生 echo 的会话钩子已经实际触发；七类钩子的官方离线 fixture 测试用于覆盖工具事件。真实模型调用因服务端账单问题受阻。原生 CLI 的实际触发情况及本次测试结果见 [历史验证记录](../reports/2026-11/muse-integration-results-2026-11-06.md)。插件被批准不证明具体执行入口会触发它；基础进程状态与工具级可观测性必须分别验收。
