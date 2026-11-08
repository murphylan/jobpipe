// 轻量 Markdown → HTML（帮助页专用，2026-11-08）：项目未引渲染库，说明书文档
// 用到的语法有限（标题/段落/粗体/行内代码/代码块/表格/列表/引用/链接/图片），
// 这里按需实现。所有文本先转义再生成标签，输出可安全用于 dangerouslySetInnerHTML。
// 例外：```svg 围栏是说明书自带的手绘图（可信本地文档），整段校验为 <svg>…</svg>
// 后原样输出；其余内容一律转义。

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function inline(s: string): string {
  // 先保护行内代码，避免其中的 ** 等被继续解析
  const codes: string[] = [];
  let t = esc(s).replace(/`([^`]+)`/g, (_m, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_m, alt, src) => {
    return `<img src="${src}" alt="${alt}" loading="lazy" />`;
  });
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) =>
    `<a href="${href}" target="_blank" rel="noreferrer">${text}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\u0000(\d+)\u0000/g, (_m, i) => `<code>${codes[Number(i)]}</code>`);
  return t;
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
}

export function markdownToHtml(md: string): string {
  let src = md.replace(/\r\n/g, "\n");
  // 去掉 Docusaurus frontmatter
  if (src.startsWith("---\n")) {
    const end = src.indexOf("\n---", 4);
    if (end > 0) src = src.slice(end + 4).replace(/^\n+/, "");
  }
  const lines = src.split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // 代码块；mermaid 围栏单独标记，帮助页加载 mermaid.js 后替换为 SVG 图
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      if (lang === "mermaid") out.push(`<div class="mermaid-diagram"><pre><code>${esc(buf.join("\n"))}</code></pre></div>`);
      else if (lang === "svg") {
        const raw = buf.join("\n").trim();
        if (raw.startsWith("<svg") && raw.endsWith("</svg>")) out.push(`<div class="svg-diagram">${raw}</div>`);
        else out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      }
      else out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { i++; continue; }
    // 标题
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    // 分隔线
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { out.push("<hr />"); i++; continue; }
    // 表格：当前行以 | 开头且下一行是分隔行
    if (line.trim().startsWith("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { rows.push(splitRow(lines[i])); i++; }
      const thead = head.map((c) => `<th>${inline(c)}</th>`).join("");
      const tbody = rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`<div class="md-tablewrap"><table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`);
      continue;
    }
    // 引用
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push(`<blockquote>${buf.map((b) => `<p>${inline(b)}</p>`).join("")}</blockquote>`);
      continue;
    }
    // 无序列表
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i++; }
      out.push(`<ul>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push(`<ol>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    // 图片独占一行时 inline() 会处理；普通段落聚合到空行/块元素为止
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() &&
      !/^(#{1,6}\s|```|>|\s*[-*]\s+|\s*\d+\.\s+|\|)/.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
