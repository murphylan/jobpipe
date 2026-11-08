

**用对话推进求职，让进展与结果清晰可见。**

JobPipe 帮助个人求职者组织岗位发现、筛选、简历准备、投递和后续跟进。你设定求职条件并批准关键动作，Muse 负责执行；通过看板，你可以查看进度、处理问题并核对结果。

首次使用请从第 2 节开始；查看日常功能请阅读第 4 节；任务暂停或结果不明确时，请查阅第 5 节。

## 1. 认识 JobPipe

### 你能获得什么

| 产品特点 | 对你的帮助 |
| --- | --- |
| 自然语言驱动 | 用对话说明目标和要求，无需学习自动化工具的节点与连线 |
| 无需手工编排 | 使用现成求职流程，无需搭建工作流、编写脚本或编辑流程配置 |
| 本地数据管理 | 业务记录保存在自己的 Mac，简历、约定和历史由自己掌握 |
| 约定持续生效 | 保存有效的求职条件和长期约定，在后续任务中重新读取和使用 |
| 过程透明可控 | 随时查看进展和阻碍，投递前保留复查与批准的决定权 |

JobPipe 适合需要持续处理多个岗位、希望减少重复操作，同时保留关键决定权的求职者。它不保证获得面试或录用，也不能代替你提供真实信息、完成必要验证或作出授权。

### 你、Muse 和系统如何配合

| 角色 | 负责什么 |
| --- | --- |
| 你 | 设定目标和条件，提供真实资料，复查材料，批准投递，处理需要本人参与的事项 |
| Muse | 读取有效约定，查找和筛选岗位，准备材料，执行获批操作，报告进度与结果 |
| 系统 | 展示任务和问题，保存用户决定，校验并维护业务记录，保留历史依据 |

看板是观察和处理事项的入口，任务通过 Muse 对话发起。系统的记录服务称为 Engine；服务在线表示可以处理记录，不代表 Muse 正在执行。

## 2. 开始使用

### 准备好资料与求职条件

准备一份最新简历，核对经历、联系方式和相关链接。在 Resumes 查看已有材料；如果尚未登记，将简历交给 Muse，按接入说明完成导入后再开始定制。

把会持续使用的要求保存到 Knowledge。建议先明确：

| 条件 | 需要说明的内容 |
| --- | --- |
| 岗位方向 | 目标职位、职能、行业及必要技能 |
| 薪资要求 | 范围、币种、计薪周期，以及不同工作方式是否采用不同要求 |
| 地域与工作方式 | 目标地区，远程、现场或混合办公，是否接受搬迁 |
| 合作方式 | 可接受的雇佣或合同形式，以及需要先确认的限制 |
| 其他要求 | 不考虑的条件、资料使用方式和需要本人决定的事项 |

这些条件由你决定，产品不预设个人身份或薪资诉求。密码、验证码和证件信息不要填入普通 Knowledge。

### 连接 Muse

1. 按项目 README 中的启动说明运行看板和 Engine，在 Engine 页面确认服务状态正常。
2. 打开 Settings，核对 JobPipe 工程位置。
3. 点击“复制接入指令”，发送给 Muse，完成项目规则入口的安装与检查。
4. 等待 Muse 确认能够读取工程规则和有效约定。

**完成标志：** Muse 已确认接入检查结果。Settings 中的“接入包已就绪”只表示文件可用，不等于安装完成；历史连接记录也不代表本次任务已经开始。

**未成功时：** 请 Muse 核对工程访问权限和规则入口。详细步骤见工程文档中的《Hatch Muse 操作手册》，不要反复发送投递任务来测试连接。

## 3. 完成第一次求职任务

建议先进行一次筛选与材料准备，确认流程可用后，再批准真实投递。

### 操作全览

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="660" viewBox="0 0 1120 660" role="img" aria-labelledby="title desc">
<title id="title">JobPipe 用户操作流程</title><desc id="desc">十一项操作分三行蛇形排列。蓝色为 JobPipe 页面，橙色为 Muse 聊天，紫色为 Muse 执行，灰色为用户准备。从准备简历到设置条件、连接并下达任务，经过准备、进展查看、审批及投递，再查看成果、跟进和更新约定。</desc>
<defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 1 1 L 9 5 L 1 9" fill="none" stroke="#94A3B8" stroke-width="1.5"/></marker></defs>
<rect width="1120" height="660" rx="20" fill="#FFFFFF"/>
<g font-family="-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif">
<text x="40" y="42" fill="#0F172A" font-size="23" font-weight="700">从准备到投递，再到下一次机会</text>
<text x="40" y="69" fill="#64748B" font-size="13">按箭头顺序阅读 · 每一步标明操作位置</text>
<rect x="40" y="89" width="10" height="10" rx="3" fill="#2563EB"/><text x="58" y="99" fill="#475569" font-size="12">JOBPIPE 页面</text>
<rect x="220" y="89" width="10" height="10" rx="3" fill="#C2410C"/><text x="238" y="99" fill="#475569" font-size="12">MUSE 聊天窗口</text>
<rect x="410" y="89" width="10" height="10" rx="3" fill="#7E22CE"/><text x="428" y="99" fill="#475569" font-size="12">MUSE 执行</text>
<rect x="590" y="89" width="10" height="10" rx="3" fill="#475569"/><text x="608" y="99" fill="#475569" font-size="12">用户准备</text>
<g fill="none" stroke="#94A3B8" stroke-width="1.7" marker-end="url(#arrow)"><path d="M 274 182 H 302"/><path d="M 544 182 H 572"/><path d="M 814 182 H 842"/><path d="M 965 240 V 298"/><path d="M 850 360 H 822"/><path d="M 580 360 H 552"/><path d="M 310 360 H 282"/><path d="M 155 418 V 476"/><path d="M 274 538 H 302"/><path d="M 544 538 H 572"/></g>
<g><rect x="40" y="128" width="230" height="108" rx="12" fill="#F1F5F9" stroke="#475569" stroke-opacity="0.2"/>
<circle cx="64" cy="153" r="12" fill="#475569"/><text x="64" y="157" text-anchor="middle" font-size="11" font-weight="700" fill="white">01</text>
<text x="84" y="157" font-size="10" font-weight="600" fill="#475569">用户准备</text>
<text x="56" y="188" font-size="18" font-weight="650" fill="#0F172A">准备简历</text>
<text x="56" y="213" font-size="11" fill="#475569">核对经历、联系方式与材料</text></g>
<g><rect x="310" y="128" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="334" cy="153" r="12" fill="#2563EB"/><text x="334" y="157" text-anchor="middle" font-size="11" font-weight="700" fill="white">02</text>
<text x="354" y="157" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="326" y="188" font-size="18" font-weight="650" fill="#0F172A">设置求职条件</text>
<text x="326" y="213" font-size="11" fill="#475569">Knowledge · 薪资、地域、合作方式</text></g>
<g><rect x="580" y="128" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="604" cy="153" r="12" fill="#2563EB"/><text x="604" y="157" text-anchor="middle" font-size="11" font-weight="700" fill="white">03</text>
<text x="624" y="157" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="596" y="188" font-size="18" font-weight="650" fill="#0F172A">连接 Muse</text>
<text x="596" y="213" font-size="11" fill="#475569">Settings · 复制接入指令给 Muse</text></g>
<g><rect x="850" y="128" width="230" height="108" rx="12" fill="#FFF7ED" stroke="#C2410C" stroke-opacity="0.2"/>
<circle cx="874" cy="153" r="12" fill="#C2410C"/><text x="874" y="157" text-anchor="middle" font-size="11" font-weight="700" fill="white">04</text>
<text x="894" y="157" font-size="10" font-weight="600" fill="#C2410C">MUSE 聊天窗口</text>
<text x="866" y="188" font-size="18" font-weight="650" fill="#0F172A">下达任务</text>
<text x="866" y="213" font-size="11" fill="#475569">说明目标、数量与授权范围</text></g>
<g><rect x="850" y="306" width="230" height="108" rx="12" fill="#FAF5FF" stroke="#7E22CE" stroke-opacity="0.2"/>
<circle cx="874" cy="331" r="12" fill="#7E22CE"/><text x="874" y="335" text-anchor="middle" font-size="11" font-weight="700" fill="white">05</text>
<text x="894" y="335" font-size="10" font-weight="600" fill="#7E22CE">MUSE 执行</text>
<text x="866" y="366" font-size="18" font-weight="650" fill="#0F172A">加载约定并准备</text>
<text x="866" y="391" font-size="11" fill="#475569">发现 → 筛选 → 定制简历</text></g>
<g><rect x="580" y="306" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="604" cy="331" r="12" fill="#2563EB"/><text x="604" y="335" text-anchor="middle" font-size="11" font-weight="700" fill="white">06</text>
<text x="624" y="335" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="596" y="366" font-size="18" font-weight="650" fill="#0F172A">查看与处理进展</text>
<text x="596" y="391" font-size="11" fill="#475569">Activity · 答复问题或接管</text></g>
<g><rect x="310" y="306" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="334" cy="331" r="12" fill="#2563EB"/><text x="334" y="335" text-anchor="middle" font-size="11" font-weight="700" fill="white">07</text>
<text x="354" y="335" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="326" y="366" font-size="18" font-weight="650" fill="#0F172A">复查与批准</text>
<text x="326" y="391" font-size="11" fill="#475569">Activity · 核对材料和关键答案</text></g>
<g><rect x="40" y="306" width="230" height="108" rx="12" fill="#FAF5FF" stroke="#7E22CE" stroke-opacity="0.2"/>
<circle cx="64" cy="331" r="12" fill="#7E22CE"/><text x="64" y="335" text-anchor="middle" font-size="11" font-weight="700" fill="white">08</text>
<text x="84" y="335" font-size="10" font-weight="600" fill="#7E22CE">MUSE 执行</text>
<text x="56" y="366" font-size="18" font-weight="650" fill="#0F172A">执行获批投递</text>
<text x="56" y="391" font-size="11" fill="#475569">操作招聘网站并保存提交证据</text></g>
<g><rect x="40" y="484" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="64" cy="509" r="12" fill="#2563EB"/><text x="64" y="513" text-anchor="middle" font-size="11" font-weight="700" fill="white">09</text>
<text x="84" y="513" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="56" y="544" font-size="18" font-weight="650" fill="#0F172A">查看今日成果</text>
<text x="56" y="569" font-size="11" fill="#475569">Today · 投递与雇主确认分开</text></g>
<g><rect x="310" y="484" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="334" cy="509" r="12" fill="#2563EB"/><text x="334" y="513" text-anchor="middle" font-size="11" font-weight="700" fill="white">10</text>
<text x="354" y="513" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="326" y="544" font-size="18" font-weight="650" fill="#0F172A">跟进后续机会</text>
<text x="326" y="569" font-size="11" fill="#475569">Jobs &amp; Applications · 面试与 Offer</text></g>
<g><rect x="580" y="484" width="230" height="108" rx="12" fill="#EFF6FF" stroke="#2563EB" stroke-opacity="0.2"/>
<circle cx="604" cy="509" r="12" fill="#2563EB"/><text x="604" y="513" text-anchor="middle" font-size="11" font-weight="700" fill="white">11</text>
<text x="624" y="513" font-size="10" font-weight="600" fill="#2563EB">JOBPIPE 页面</text>
<text x="596" y="544" font-size="18" font-weight="650" fill="#0F172A">更新长期约定</text>
<text x="596" y="569" font-size="11" fill="#475569">Knowledge · 下次任务重新加载</text></g>
<text x="335" y="272" fill="#64748B" font-size="12">审批前可修改、暂缓或跳过；没有批准不投递。</text>
<text x="190" y="453" fill="#64748B" font-size="12">有疑问先暂停，用户答复后由 Muse 确认恢复。</text>
<rect x="850" y="484" width="230" height="108" rx="12" fill="#F8FAFC"/>
<text x="866" y="512" fill="#475569" font-size="12" font-weight="600">形成下一轮工作的依据</text>
<text x="866" y="538" fill="#64748B" font-size="12">保留事实与结果</text>
<text x="866" y="559" fill="#64748B" font-size="12">调整条件后再下达新任务</text>
<text x="40" y="632" fill="#64748B" font-size="12">审批也可在 Muse 聊天中明确表达，需指明岗位与材料；后台执行不是额外需要打开的页面。</text>
</g></svg>
```

图中蓝色为 JobPipe 页面，橙色为 Muse 聊天窗口，紫色为 Muse 执行，灰色为用户准备。按箭头顺序阅读；涉及新事实、必要验证或未获授权的操作时，流程会停下来等待你处理。

### 第一步：下达任务

在 Settings 点击“复制任务启动说明”，连同具体目标发送给 Muse。例如：

> 请按已保存的求职条件筛选本轮岗位，先准备材料交我复查。没有我的批准不要投递；缺少事实时集中列出问题，并在 Activity 更新进展。

**你应看到：** Muse 确认本次任务范围及已加载的约定，Activity 出现相应任务和进展。复制启动说明本身不会启动任务。

### 第二步：查看岗位与材料准备

流程依次经过 **发现 → 筛选 → 定制简历 → 复查 → 投递 → 记账**。

Muse 核查职位原文与求职条件，说明匹配理由或跳过原因，再为适合的岗位准备材料。已有内容完全相同的简历可以复用，已投递材料的版本保留。

**你应看到：** Today 展示今日岗位和业务阶段；Activity 展示当前岗位、正在进行的步骤及最新进展。完整岗位信息和材料可在详情中查看。

### 第三步：答复问题并复查

需要补充事实、批准或本人操作时，进入 Activity 的“待定队列”，打开对应抽屉查看背景，再提交答复。长期适用的答复需要另行确认保存，临时决定不会自动变成永久规则。

复查时重点看目标岗位、简历版本、关键申请答案和本次授权范围。你可以要求修改、批准、暂缓或跳过。

> 批准向这个岗位投递，使用本次复查的简历和答案。遇到新的事实问题或超出授权的操作，请先询问我。

**你应看到：** 用户决定已记录。答复问题后可能先显示“已答复待续跑”，Muse 真正继续后才显示恢复；批准也不等于网站已完成提交。

### 第四步：投递并核对结果

Muse 在获批范围内填写表单、上传材料并核对关键内容。若信息不一致、需要验证或提交结果不明确，应暂停处理，不带着疑问重复提交。

**你应看到：** Activity 更新执行结果与证据，Today 更新今日成果，Jobs & Applications 保留完整投递与跟进记录。

“投递完成”和“雇主已确认”含义不同。确认页、申请编号及确认邮件是核对结果的依据；缺少确认时，状态应明确表达不确定性。

ATS 是招聘管理系统，即雇主接收申请、管理候选人和招聘流程的平台。

## 4. 日常使用

### Today：看今日投递与成果

Today 是今日投递流水线。默认计划目标为 20 个职位，可以超额；目标不是列表容量上限。

今日已投递项保留并显示结果，往日已投递项在 Jobs & Applications 查看。未投递的结转任务继续保留，直到提交或被放弃；日期按系统的业务时区划分。

**审批、答复、接管和恢复事项在 Activity 处理，Today 不设待处理模块。**

### Activity：看过程，处理需要你参与的事项

- **活动流：** 查看活动、环节、状态、最新进展和更新时间。六环节开始前、进行中和结束后均应有对应反馈；批次可以查看逐岗进展。
- **待定队列：** 处理审批、缺失信息和本人操作等事项。
- **详情抽屉：** 点击记录，查看完整背景、过程、证据及处理入口。
- **运行详情：** 查看服务状态与诊断信息；业务结果仍以实际记录为准。

需要整理列表时，可按页面提供的删除入口移除允许删除的活动。活动删除不等于撤销投递，不会删除岗位与投递记录；操作保留审计历史。

### Jobs & Applications：管理完整求职记录

搜索或筛选岗位，点击记录查看详情与历史。这里覆盖已投递后的雇主确认、回复、面试、Offer 以及结束状态；Today 看当天，这里看完整记录。

### Resumes：查看材料与引用关系

以实际 PDF 为主线查看简历、关联版本和岗位引用，按页面提供的入口预览或下载。内容相同的材料复用已有版本；修改已投递材料时保留原版本，便于核查当时提交的内容。

### Knowledge：维护长期事实与约定

1. 点击右上角“添加 Knowledge”，在抽屉填写标题、内容与标签。
2. 需要在任务开始时提供给 Muse 的非秘密约定，按接入规范添加 `agent-context` 标签。
3. 确认保存成功后，再让 Muse 在下一任务读取。

点击已有条目可维护内容；修改保留历史，归档后不再作为后续任务的有效约定。任务进行中更改重要条件时，告知 Muse 重新读取并确认是否需要暂停。

例如：“本次搜索范围以我确认的目标地区为准。”不要只依赖对话中的“记住了”，也不要将密码或验证码保存为约定。

### Settings 与辅助页面

| 页面 | 使用时机 |
| --- | --- |
| Settings | 首次接入、工程位置变化或检查 Muse 连接时；配置、上下文加载和真实活动分别确认 |
| Skill | 需要了解执行规范的来源与适用范围时 |
| Workflow | 需要了解六环节和参与分工时 |
| Engine | 检查服务、记录处理结果、回执或数据异常时 |

操作回执和变更历史用于核对发生过什么，不需要在日常使用中手工编辑。

## 5. 理解状态与处理异常

### 常见状态

| 状态或提示 | 含义与下一步 |
| --- | --- |
| 进行中 | 最近有有效执行信号，可打开 Activity 查看当前动作 |
| 等待用户 | 需要事实、批准或本人操作，进入对应待定事项处理 |
| 已答复待续跑 | 答复已记录，尚未确认 Muse 实际恢复 |
| 待恢复／运行信号过期 | 暂无新鲜信号，先核查已有进展，不直接重做整项任务 |
| 执行失败 | 本次运行遇到错误，查看原因及已完成部分；不等于岗位被拒绝 |
| 运行结束 | 本次执行尝试已结束，不自动代表所有业务均已完成 |
| 投递完成／雇主已确认 | 分别核对提交结果和雇主确认依据，不互相替代 |

### 遇到问题怎么办

| 问题 | 建议操作 |
| --- | --- |
| Muse 在工作，Activity 却没有更新 | 先查 Engine 是否在线，再请 Muse 核对本次规则加载和进度上报；聊天回复不能代替活动记录 |
| 已答复，但任务没有继续 | 查看源活动，请 Muse 读取该决定并确认恢复，不重复发起整批任务 |
| 上传后字段或附件不正确 | 停止提交，确认资料和材料版本，修正并重新核对 |
| 提交后超时、空白或没有明确结果 | 请 Muse 先检查站点记录、确认页或已授权邮箱，不要直接再次投递 |
| Knowledge 未提示保存成功 | 查看处理结果；成功前不要认为约定已生效 |
| 出现数据核对告警 | 打开详情了解原因；可通过“生成清空命令”复制给 Muse 核查处理。生成命令不会自动清空数据，删除历史仍需明确范围 |

登录、人机验证或必须本人处理的事项需要你接管。Muse 默认使用其云端浏览器；如需改用你的 Mac 或其他执行方式，应先说明并取得相应授权。

## 6. 数据、隐私与使用边界

- **本地保存，联网执行。** 业务数据保存在 Mac；Muse 和招聘网站操作仍需联网，本地保存不等于整个过程完全离线。
- **个人信息与公开说明分开。** 本手册仅使用通用说明和示例。真实资料、薪资要求、账号情况与本机配置留在个人环境，不写进公开文档。
- **重要动作先授权。** 投递、外发邮件及其他外部动作遵守你的授权范围；新的事实问题不能靠猜测补齐。
- **秘密单独处理。** 密码、验证码和证件等信息按实际可用的安全方式处理，不进入普通 Knowledge、活动说明或日志。
- **结果可追溯。** 系统保存材料版本、用户决定和处理依据。删除活动不撤销网站上的申请，本地记录修改也不能撤回已发生的外部操作。

安装与命令说明见项目 README；Muse 接入与排障见工程文档中的《Hatch Muse 操作手册》。实际网站支持情况及需要接管的步骤，以当前任务反馈为准。
