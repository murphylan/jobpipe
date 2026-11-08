import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import KnowledgeView from "../components/views/KnowledgeView";
import KnowledgeDrawer from "../components/views/KnowledgeDrawer";
import type { KnowledgeEntry } from "./knowledge";

const entry: KnowledgeEntry = { id: "fixture", title: "Registration method", body: "Use confirmed email", tags: ["agent-context"], createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", archived: false };
const actions = { busy: false, error: "", onClose: () => {}, onSave: async () => {}, onArchive: async () => {} };
it("Knowledge opens with its list and add button, without an inline editor", () => {
  const html = renderToStaticMarkup(createElement(KnowledgeView, { quirks: [] }));
  expect(html).toContain("添加 Knowledge");
  expect(html).toContain('aria-label="知识条目"');
  expect(html).not.toContain("<textarea");
  expect(html).not.toContain('role="dialog"');
});
it("the entry drawer exposes editable content and archive actions in a named dialog", () => {
  const html = renderToStaticMarkup(createElement(KnowledgeDrawer, { ...actions, selection: { kind: "entry", entry } }));
  expect(html).toContain('role="dialog"'); expect(html).toContain('aria-modal="true"');
  expect(html).toContain(entry.title); expect(html).toContain(entry.body); expect(html).toContain("agent-context");
  expect(html).toContain("保存修改"); expect(html).toContain("归档");
  expect(html).not.toContain('readOnly=""');
});
it("archived entries can be restored but are not offered an edit save", () => {
  const html = renderToStaticMarkup(createElement(KnowledgeDrawer, { ...actions, selection: { kind: "entry", entry: { ...entry, archived: true } } }));
  expect(html).toContain("恢复条目"); expect(html).not.toContain("保存修改");
  expect(html).toContain('readOnly=""');
});
