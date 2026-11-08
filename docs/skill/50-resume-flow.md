# 简历流程

## 读取与冻结

resumes.json 是只读构件库，kind 包括 skill / project / summary / experience / education，并保留来源。按岗位使用已核实经历，不编造事实。新版本名用芝加哥日期与四位年份 vYYYYMMDD-<jobId>；旧年份错误不自动迁移。
已投递引用的版本与 PDF 冻结。推荐 selected 与用户本次批准分开，修改内容创建新版本。重生成只由用户在聊天明确发令，不自动检查或重生成。

## 新 PDF 的唯一入口

1. 在 data/inbox/evidence/<name>.pdf 提交完整文件；使用临时文件写完后原子发布。文件须是普通 PDF，头为 %PDF-，不超过 25 MiB，不使用链接或越界路径。
2. 定制提交 TAILORED，payload 包含 jobId、resumeVersion、file（上述 inbox 相对路径），可选 note。
3. 导入提交 RESUME_IMPORTED，payload 包含 version、file，可选 jobId / note；这是高审批事件，等待用户控制台批准。
4. Engine 在事务中验证并提升为 data/resume-files/<taskId>.pdf，再注册版本；目标已存在时拒绝覆盖。原 inbox 证据保留。
5. 读取 Receipt 及正式 resume-versions.json 确认注册和 file 路径；未提交成功、被拒或缺文件时不能宣称已可投递。

现有导入 handler 只注册版本与 PDF，不拆解写入 resumes.json 构件库，也不自动变更 selected；没有对应已实现事件时报告限制，不直接补写。现存正式 PDF 引用仍可只读使用。

事件格式、幂等与恢复见 [inbox-contract.md](inbox-contract.md)。选用版本仍需聊天确认，PDF 生成或注册不等于投递授权。
