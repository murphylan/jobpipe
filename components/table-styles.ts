// JobPipe 全系统统一表格样式（用户 2026-11-04 定版，向 Activity 页看齐）
// 用法：import { TABLE_WRAP, TABLE_HEADER, TABLE_ROW, TABLE_STYLE } from "./table-styles";

export const TABLE_WRAP = {
  marginBottom: 12,
  overflowX: "auto" as const,
  background: "#fff",
  border: "1px solid #dbe7f3",
  borderRadius: 12,
};

export const TABLE_HEADER = {
  display: "grid" as const,
  padding: "10px 12px",
  fontSize: 13,
  color: "#666",
  fontWeight: 400,
  borderBottom: "2px solid #dbe7f3",
  background: "#fff",
};

export const TABLE_ROW = {
  display: "grid" as const,
  padding: "10px 12px",
  cursor: "pointer",
  borderBottom: "1px solid #eef3f9",
  fontSize: 14,
};

// hover 高亮（需配合 className 使用）：
// <style>{`.jobs-table .tr-body:hover { background: #e8f1fb; }`}</style>
// 行 div 加 className="tr tr-body"，外层容器加 className="jobs-table"
export const TABLE_HOVER_CSS = `.jobs-table .tr-body:hover { background: #e8f1fb; }`;

export const TABLE_CELL = {
  fontSize: 14,
  verticalAlign: "top" as const,
};

export const TABLE_CELL_MUTED = {
  fontSize: 13,
  color: "#666",
  verticalAlign: "top" as const,
  whiteSpace: "nowrap" as const,
};
