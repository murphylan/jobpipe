"use client";

import { useEffect, useMemo, useRef } from "react";
import { CircleHelp } from "lucide-react";
import { markdownToHtml } from "../../lib/markdown";

// The server provides optional manual content; private source paths never reach this component.

const CSS = `
.helpdoc { font-size: 14px; line-height: 1.75; color: #1e293b; }
.helpdoc h1 { font-size: 24px; font-weight: 700; color: #0f172a; margin: 4px 0 14px; }
.helpdoc h2 { font-size: 19px; font-weight: 700; color: #0f172a; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #eef3f9; }
.helpdoc h3 { font-size: 16px; font-weight: 600; color: #0f172a; margin: 20px 0 8px; }
.helpdoc h4 { font-size: 14px; font-weight: 600; color: #0f172a; margin: 16px 0 6px; }
.helpdoc p { margin: 8px 0; }
.helpdoc ul, .helpdoc ol { margin: 8px 0; padding-left: 22px; }
.helpdoc li { margin: 3px 0; }
.helpdoc a { color: #2563eb; }
.helpdoc code { font-family: "JetBrains Mono", monospace; font-size: 12.5px; background: #f1f5f9; border-radius: 4px; padding: 1px 5px; }
.helpdoc pre { background: #0f172a; color: #e2e8f0; border-radius: 10px; padding: 14px 16px; overflow-x: auto; margin: 12px 0; }
.helpdoc pre code { background: none; color: inherit; padding: 0; font-size: 12.5px; line-height: 1.6; }
.helpdoc blockquote { margin: 12px 0; padding: 10px 14px; background: #f8fafc; border-left: 3px solid #cbd5e1; border-radius: 0 8px 8px 0; color: #334155; }
.helpdoc blockquote p { margin: 2px 0; }
.helpdoc hr { border: none; border-top: 1px solid #e2e8f0; margin: 20px 0; }
.helpdoc img { max-width: 100%; border-radius: 8px; }
.helpdoc .mermaid-diagram { text-align: center; margin: 14px 0; }
.helpdoc .mermaid-diagram svg { max-width: 100%; height: auto; }
.helpdoc .svg-diagram { text-align: center; margin: 14px 0; }
.helpdoc .svg-diagram svg { max-width: 100%; height: auto; }
.helpdoc .md-tablewrap { overflow-x: auto; margin: 12px 0; }
.helpdoc table { border-collapse: collapse; width: 100%; font-size: 13px; }
.helpdoc th, .helpdoc td { border: 1px solid #dbe7f3; padding: 7px 10px; text-align: left; vertical-align: top; }
.helpdoc th { background: #f8fafc; font-weight: 600; color: #0f172a; }
`;

export default function HelpView({ doc }: { doc: string | null }) {
  const html = useMemo(() => (doc ? markdownToHtml(doc) : ""), [doc]);
  const rootRef = useRef<HTMLDivElement>(null);
  // Mermaid 图：页面挂载后从 CDN 加载 mermaid.js，把标记好的源码块替换为 SVG；
  // 加载失败时保留代码块原样展示，不影响其余内容。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid-diagram"));
    if (!nodes.length) return;
    let cancelled = false;
    (async () => {
      try {
        const url = "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
        const mermaid = (await import(/* @vite-ignore */ url)).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: "loose", theme: "default" });
        for (let k = 0; k < nodes.length; k++) {
          const code = nodes[k].querySelector("code")?.textContent ?? "";
          if (!code.trim()) continue;
          const { svg } = await mermaid.render(`help-mmd-${k}`, code);
          if (!cancelled) nodes[k].innerHTML = svg;
        }
      } catch { /* CDN 不可达时保留代码块 */ }
    })();
    return () => { cancelled = true; };
  }, [html]);
  return (
    <div className="content">
      <div className="head">
        <div className="hicon"><CircleHelp size={24} strokeWidth={1.6} /></div>
        <div>
          <div className="t"><h1>Product Manual</h1></div>
          <p>JobPipe 产品说明书</p>
        </div>
      </div>
      <style>{CSS}</style>
      <div style={{ background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, padding: "22px 26px" }}>
        {doc ? (
          <div className="helpdoc" ref={rootRef} dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <div style={{ color: "#94a3b8", fontSize: 14 }}>
            说明书文件缺失或暂不可用。说明书位于工程内 docs/product-manual.md，随工程一同维护。
          </div>
        )}
      </div>
    </div>
  );
}
