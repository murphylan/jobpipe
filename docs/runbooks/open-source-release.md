# 开源发布操作说明

## 发布内容

仓库包含源码、MIT 许可证、通用产品说明、执行契约、运行手册和虚构测试。
个人业务目录、历史报告、浏览器状态、本机配置、归档、日志和备份不属于发布内容。不要打包整个工作目录作为 Release 附件；如需源码包，使用 GitHub 生成的 Source code 或 `git archive`。

## 发布前验证

```sh
npm ci
npm run check
npm run privacy:history
```

另外从只含已跟踪源码的新目录验证安装、测试与构建，初始化和运行检查也只使用该隔离目录。不要为了验收启动真实 Engine 或注入真实 inbox。

## GitHub 设置

1. 检查默认分支和发布提交，确认待公开内容经过隐私检查。
2. 检查所有分支、标签、PR、Release 附件、Actions 日志和产物；工作区已脱敏不代表旧历史已脱敏。
3. 有历史敏感内容时，先备份到不上传的本地目录，再单独确认历史重写范围。GitHub 的旧 PR 引用、缓存和已有克隆可能仍保留旧对象，重写 main 不能保证清除这些副本；必要时联系 GitHub Support。阻断项未解决前保持私有。
4. 启用 Issues、GitHub 私密漏洞报告；验证 Security 页存在私下报告入口。
5. 为 main 设置 Pull Request 审查和 Source checks 检查要求；只有 CI 实际成功后才将其设为必需检查。
6. 补充仓库简介和主题标签。截图必须来自空工作区或隔离的虚构数据，不使用真实业务画面。
7. 最后核对许可证、依赖许可与已知限制。转公开属于独立发布动作，确认后再更改可见性。

## 标签与版本

功能和行为仍在变化时，使用开发版说明，不承诺无人值守或所有 ATS 通用。验证后再创建版本标签和 Release，发布说明写清本次能力、限制及升级步骤。

历史清理限制参见 [GitHub 官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)。Support 是否受理取决于其敏感数据政策，不能保证移除普通非敏感历史。
