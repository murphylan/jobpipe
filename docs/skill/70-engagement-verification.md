# 合作模式核实话术（docs/skill/70）

> 用于向招聘方核实是否接受公司签约、C2C、供应商合作。
> 所有外发邮件需用户审批后方可发送（单发送人纪律）。

未核实允许公司签约时，不得以 任何公司名义联系；需用户批准后使用中性的个人询问。用户未确认公司身份时不要使用公司模板或填写占位信息。以下公司身份模板仅适用于已确认允许公司合作的场景，不代表发送授权。

协议见 [inbox-contract.md](inbox-contract.md)。

## 模板 A：初次核实（招聘方/猎头）

**Subject**: Question about [Job Title] engagement model

Hi [Name],

I'm interested in the [Job Title] position you posted. I run a US-registered
software company ([Company Name]) and would like to clarify
the engagement model:

1. Do you accept C2C / Corp-to-Corp contracts for this role?
2. If engaged as a company, can we assign our engineer ([Name],
   [verified relevant experience]) to the project?
3. Is this W2-only, or are 1099 / Independent Contractor arrangements considered?

Looking forward to your reply.

Best regards,
[Your Name]
[Company Name]
[Approved contact details]

---

## 模板 B：跟进（无回复 3 天后）

**Subject**: Re: Question about [Job Title] engagement model

Hi [Name],

Just following up on my question about the engagement model for
[Job Title]. We're trying to determine whether to proceed as
individual candidates or as a contracting company.

Any clarification would be appreciated.

Best,
[Your Name]

---

## 记录规范

记录真实来源与原文证据；新岗位随 DISCOVERED.payload.job.verificationEvidence 提交，已有可筛选岗位通过 SCREENED.payload.notes 记录。现有 SCREENED 不更新专用合作字段，不能宣称已更新 verificationEvidence；已批准岗位更正需先报告限制。格式如下：

```
[日期] [渠道: 邮件/电话/LinkedIn] [联系人]
原文引用: "..."
结论: companyContractAllowed=Yes/No
```

无回复 7 天后标记为 Unknown，不再跟进。
