import { expect, it } from "vitest";
import { publicationFindings } from "./publication-privacy";
it("rejects private directories, backups and real contact details without disclosing values", () => {
  const email = ["fixture", "gmail.com"].join("@");
  const result = publicationFindings("data/profile.json", email);
  expect(result.map(item => item.rule)).toEqual(["private-or-generated-directory", "non-example-email"]);
  expect(JSON.stringify(result)).not.toContain(email);
  expect(publicationFindings(".env.local", "").length).toBe(1);
  expect(publicationFindings("docs/reports/a.md", "").length).toBe(1);
  expect(publicationFindings("backup.json", "").length).toBe(1);
});
it("permits synthetic examples and rejects absolute personal paths and credentials", () => {
  expect(publicationFindings(".env.example", "applicant@example.com")).toEqual([]);
  expect(publicationFindings("app/test.ts", "/" + "Users/fixture/project")[0].rule).toBe("absolute-user-path");
  expect(publicationFindings("app/test.ts", "ghp_" + "x".repeat(40))[0].rule).toBe("credential-material");
});

it("rejects browser sessions, traces and local log archives", () => {
  expect(publicationFindings("playwright/.auth/state.json", "").map(item => item.rule)).toContain("browser-runtime-artifact");
  expect(publicationFindings("test-results/trace.zip", "").map(item => item.rule)).toContain("browser-runtime-artifact");
  for (const file of ["debug.log", "session.har", "private.tgz"]) expect(publicationFindings(file, "").map(item => item.rule)).toContain("private-artifact");
});

it("rejects local documentation dependencies without exposing the private URL", () => {
  const origin = ["http://localhost", "4007"].join(":");
  const findings = publicationFindings("docs/runbooks/guide.md", `[Guide](${origin}/docs/private-guide)`);
  expect(findings.map(finding => finding.rule)).toContain("local-documentation-link");
  expect(JSON.stringify(findings)).not.toContain(origin);
  expect(publicationFindings("lib/markdown.ts", `const base = "${origin}";`).map(finding => finding.rule)).toContain("local-renderer-origin");
  expect(publicationFindings("README.md", "[Guide](docs/product-manual.md)")).toEqual([]);
});
