import { expect, it } from "vitest";
import { markdownToHtml } from "./markdown";
it("keeps root-relative images on the application origin", () => {
  const html = markdownToHtml("![Guide](/img/guide.svg)");
  expect(html).toContain('src="/img/guide.svg"');
  expect(html).not.toContain("localhost");
});
it("preserves relative and explicitly supplied public image addresses", () => {
  expect(markdownToHtml("![Guide](./guide.svg)")).toContain('src="./guide.svg"');
  expect(markdownToHtml("![Guide](https://example.com/guide.svg)")).toContain('src="https://example.com/guide.svg"');
});
