# Settings：绑定 JobPipe 与 Muse

这是 Settings 中“可选：Muse Code CLI”折叠区的使用说明。默认 Hatch Muse 接入见 [Hatch 操作手册](muse-hatch.md)；产品说明见 [JobPipe 产品说明书](../product-manual.md)。

入口：侧栏 Settings 或 `/settings`。

## 使用流程

1. 确认当前 JobPipe 项目路径，填写 Muse 可执行文件绝对路径。默认优先发现本机已安装的原生二进制，避免仅检查版本就触发 shell launcher 自动更新。
2. 点击保存绑定。UI 仅提交 MUSE_SETTINGS_CHANGED 到 inbox；Engine 写入 `data/muse-settings.json` 并产生 Receipt。页面等待成功 Receipt 后才显示已保存。Engine 未运行时保持排队状态。
3. 点击检查环境。仅检查已提交的配置，调用固定的版本与插件清单命令；不启动模型。未安装、授权不全、清单不可读、插件来源指向其他项目或入口 Skill 缺失会显示待处理，不能以文件存在冒充连接成功。
4. 审查并复制配置命令，在终端执行。命令先验证插件，再从临时工作目录按 user scope 安装，最后批准钩子；前一步失败就停止。临时目录只作为安装器工作目录，不复制业务文档，也不修改 Muse 的默认项目目录或信任设置。
5. 设置本次环节和已准备好的任务文档绝对路径，复制启动命令。启动器固定工作目录，读取保存的 Muse 路径，通过 prompt-file 加载 Engine 上下文，再关联真实进程和 Activity。

保存路径不等于插件安装完成，也不等于现有 Muse 会话已加载上下文。页面分别展示配置、插件检查、曾收到的会话信号和工具信号；历史时间戳不代表当前在线。

当前服务的项目路径由 PIPELINE_DIR／服务工作目录决定，页面不搬迁或重定向真实业务数据。项目迁移后重新打开新实例的 Settings 保存绑定、重新生成命令。恢复旧 Muse 路径也通过保存新版本完成，保留历史。

## Muse 如何找到 AGENTS.md

插件 v0.2.0 添加 `jobpipe-start` Skill。该 Skill 通过 `muse plugins inspect jobpipe-observer --json` 的 `record.source.path` 定位原插件目录，再取得原项目根，读取原始 AGENTS.md 和阶段规范。它不把规则复制进 Muse 默认目录，也不从插件缓存位置猜项目位置。

正常运行使用启动器的固定 workspace 和上下文包；在其他目录打开的旧会话，可通过轻量 Skill 找到项目，但不会因此自动接管本次运行。路径失效时应修复绑定，不能静默选择另一个项目。

## 数据与权限边界

- Settings POST 沿用 loopback Host、同源 Origin 和 console token 校验。
- UI 只发布 inbox 事件，Engine 负责正式配置、版本历史、Receipt、Run、备份和 journal。
- expectedVersion 在 API 和 Engine 两次校验，避免排队期间并发保存覆盖配置。
- 路径和命令采用结构化参数及 shell 单引号转义；浏览器不提供任意命令执行接口。
- 诊断仅执行已提交的 Muse 路径及固定参数。用户应选可信的原生 Muse 文件；自定义脚本本身的行为不受 JobPipe 控制。
- 配置损坏时读取和保存均失败关闭，不用默认值覆盖原文件。
- 撤销命令仅撤销插件授权，不删除历史业务数据。账号方法和 vault 引用通过 Knowledge 管理，不在 Settings 保存密码。

## 文件级实现

- 页面：`components/views/SettingsView.tsx`、`app/settings/page.tsx`，并接入 App／Sidebar。
- API：`app/api/settings/muse/route.ts`，GET 为只读状态，POST 区分排队保存与显式诊断。
- Engine：`lib/engine/muse-settings.ts`，接入 daemon、registry、git 文件映射和 STATE_FILES。
- 诊断和命令：`lib/muse-environment.ts`、`lib/muse-commands.ts`。
- 启动器：`scripts/muse-start.ts` 读取 Engine 已提交配置，保留显式 muse-bin 覆盖。
- Muse：原插件增加轻量 Skill，保留原有七类 hooks。
- 测试：`lib/engine/muse-settings.test.ts`，覆盖 Engine 唯一写入、Receipt 幂等、并发版本、损坏数据、来源/token、诊断能力、信号分层和实际 shell 路径转义执行。

真实模型投递验收仍受此前 Muse 服务端 billing_error 限制。本次不向真实 inbox 投递测试事件，不启动真实 Engine daemon，也不静默更新用户已安装的插件；用户可在页面审查 v0.2.0 配置命令后更新。

## 本次验证

- 类型检查通过；全量 Vitest 50 个文件、366 项通过；生产构建通过。
- Muse 原生 Skill 和插件校验均 valid=true、diagnostics=[]。
- 命令转义通过真实 shell 隔离执行测试，包含单引号、空格、反引号和命令替换字符的路径均按字面参数传递。
- 测试仅使用临时数据；本次未执行页面生成的用户级安装／授权命令，现有安装可由用户在 Settings 检查后更新。
- 保留现有 Dashboard、ActivityView、Console 及文档的其他未提交修改；本次仅提交 Settings 与必要协议增量。
