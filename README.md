# JobPipe

**用对话推进求职，让进展与结果清晰可见。**

Local-first job search automation with human approval and observable execution.

JobPipe 帮助个人求职者组织 **发现 → 筛选 → 定制简历 → 复查 → 投递 → 记账**。用户决定目标和授权，Muse 执行任务，Engine 校验并保存可信记录。看板负责展示今日成果、实时进度和需要用户处理的事项。

项目处于积极开发阶段，当前以 **Mac 本地工作区 + Hatch Muse** 为主要使用方式。它不是完全离线产品，也不保证所有招聘网站都能无人值守投递。

## 特点

- **自然语言驱动**：向 Muse 说明任务，无需自行搭建工作流。
- **过程可见**：Activity 展示实际进展、等待和恢复事项。
- **关键动作受控**：投递前须批准，表单计划、关键值读回和提交尝试共同保护执行。
- **约定可延续**：非秘密事实保存在 Knowledge，任务开始时重新加载。
- **本地数据**：JSON、CSV 和 PDF 保存在本机；Engine 是业务数据唯一写入者，不需要数据库或独立调度平台。

## 快速开始

### 环境要求

- Node.js **22.18+（22 LTS）或 24+**，npm 或 pnpm。
- Git，用于本地业务记录审计。
- Python 3，用于 Muse 接入助手及部分测试。
- 使用 Hatch Muse 执行时，需要其能够访问本机工程的设备文件能力；不假设 Muse 与 Mac 共享文件系统。

### 安装并初始化

```sh
git clone https://github.com/murphylan/jobpipe.git
cd jobpipe
npm ci
npm run engine -- init
```

`init` 只接受空工作区，创建空记录和独立的本地业务 Git 仓库；不导入个人资料或演示岗位。已有 `data/` 的用户跳过初始化，命令会拒绝覆盖现有工作区。

在两个终端分别运行：

```sh
# 终端一：看板
npm run dev

# 终端二：Engine
npm run engine -- daemon
```

打开 `http://localhost:5173`。Engine 在前台运行，启动成功显示 PID；Ctrl+C 停止。已有实例时先运行 `npm run engine -- heartbeat`，不要删除正在使用的锁文件。

pnpm 对应使用 `pnpm install --frozen-lockfile`、`pnpm run engine init`、`pnpm run dev` 和 `pnpm run engine daemon`。

### 连接 Muse 并开始任务

1. 打开 Settings，核对工程位置，复制接入指令给实际的 Muse 会话。
2. 按 [Hatch Muse 操作手册](docs/runbooks/muse-hatch.md)完成 Skill 安装和文件访问检查。
3. 准备简历及真实资料，在 Knowledge 保存非秘密求职条件；提供给 Agent 的条目按规范标记 `agent-context`。
4. 先进行不提交申请的筛选演练，确认上下文加载、Activity 上报及回执读取。
5. 实际投递前复查材料并明确批准；遇到验证码、必要登录或提交结果不确定时，按任务反馈处理。

`npm run muse -- --help` 提供接入说明和预览，不会启动 Hatch。`npm run muse:cli -- --help` 是独立的可选旧 Muse Code CLI 入口，不能替代 Hatch 接入。

## 页面

| 页面 | 用途 |
| --- | --- |
| Today | 今日投递流水线及成果；默认计划 20 个，可超额 |
| Activity | 执行过程、待定事项、用户答复与恢复入口 |
| Jobs & Applications | 完整岗位与投递跟进记录 |
| Resumes | 实际 PDF、版本和岗位引用关系 |
| Knowledge | 用户确认的非秘密事实与长期约定 |
| Settings / Engine | 执行环境接入、服务状态和记录核对 |
| Product Manual | [完整用户教程](docs/product-manual.md)，也可通过 `/help` 阅读 |

## 数据与隐私

`PIPELINE_DIR` 可指定包含 `data/` 的工程根；默认使用当前工作目录。主要目录：

```text
app/                  路由与 API
components/           看板界面
lib/engine/           校验、事务、生命周期与业务写入
integrations/muse/    Muse 接入包
scripts/              命令入口
docs/                产品手册、执行契约与运行手册
data/                 私有运行数据（不上传）
```

Agent 与页面提交 inbox 请求，Engine 统一处理；请求排队、运行结束和业务确认分别判断。Receipt、Changelog、备份和业务 Git 提供历史依据。外部网站操作无法通过本地回滚撤销。

真实资料、凭证、浏览器状态、PDF、日志、本机环境文件和历史报告不属于公开源码。不要上传自己的 `data/` 或整个工程目录。新安装不包含演示业务数据，用户资料需要自行提供。

本地看板不应直接暴露公网。漏洞报告及部署边界见 [SECURITY.md](SECURITY.md)。

## 开发与验证

```sh
npm run check                 # 隐私、类型、测试与构建
npm run privacy:history       # 检查本地可达 Git 历史
npm run engine -- validate    # 只读校验当前工作区
npm run engine -- heartbeat   # 只读检查 Engine
```

测试使用临时目录和虚构资料，不应启动真实投递或写入真实收件箱。隐私工具检查匹配类型和文件位置，不输出匹配值；它不保证清除 GitHub 的历史 PR 引用或缓存。

- [产品说明书](docs/product-manual.md)
- [文档入口](docs/README.md)
- [参与贡献](CONTRIBUTING.md)
- [发布操作说明](docs/runbooks/open-source-release.md)

## 当前限制

- 需要独立安装并授权 Muse；仅安装 JobPipe 不代表 Agent 已连接。
- 浏览器和招聘网站行为取决于执行端及站点能力，必要时仍需本人操作。
- 目前面向个人使用，不包含多租户隔离或公网服务的完整安全设施。
- CI 测试不替代真实 Muse 会话和获批网站操作的端到端验收。

## 许可证

[MIT](LICENSE)。第三方依赖、字体和运行工具仍适用各自的许可证，见 [第三方组件说明](THIRD_PARTY_NOTICES.md)。
