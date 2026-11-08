export type PrivacyFinding = { file: string; rule: string };

/** Public source only. Findings deliberately omit matched values. */
export function publicationFindings(file: string, content: string): PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  const add = (rule: string) => findings.push({ file, rule });
  if (/^(?:data|\.local-archive|\.vinext|node_modules|dist|\.aws|\.ssh|\.agents|\.codex)\//.test(file) || /^docs\/(?:reports|archive)\//.test(file)) add("private-or-generated-directory");
  if (/(?:^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith(".env.example")) add("local-environment");
  if (/\.bak(?:-|$)|backup.*\.json$|\.(?:pdf|csv|pem|key|p12|pfx|bundle|zip|tar\.gz)$/.test(file)) add("private-artifact");
  if (/\/Users\/[A-Za-z0-9_.-]+\//.test(content)) add("absolute-user-path");
  if (/avatars\.githubusercontent\.com\/u\/\d+/.test(content)) add("personal-avatar");
  const emails = content.match(/[A-Za-z0-9_.+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (emails.some(email => !/@(?:[^@]*\.)?example\.(?:com|org|net|invalid|test)$/.test(email) && !/@localhost$/.test(email))) add("non-example-email");
  if (/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(content)) add("credential-material");
  if (/(?:^|\/)(?:test-results|playwright-report)(?:\/|$)/.test(file) || /(?:^|\/)playwright\/\.auth\//.test(file)) add("browser-runtime-artifact");
  if (/\.(?:log|har|trace|tgz|tar|7z|rar)$/.test(file)) add("private-artifact");
  if (/https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/docs(?:\/|\b)/.test(content)) add("local-documentation-link");
  if (file === "lib/markdown.ts" && /https?:\/\/(?:localhost|127\.0\.0\.1):\d+/.test(content)) add("local-renderer-origin");
  return findings;
}
