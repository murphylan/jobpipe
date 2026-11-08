"use client";

import { useMemo, useState, type ReactNode } from "react";
import { GraduationCap } from "lucide-react";
import type { SkillDoc, SkillFile } from "../../lib/datafiles";

/** Tiny markdown renderer: headings, lists, **bold**, `code`. Enough for skill docs. */
function inline(t: string): ReactNode {
  const parts = t.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.length > 2 && p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={i} className="ver">
          {p.slice(1, -1)}
        </code>
      );
    if (p.length > 4 && p.startsWith("**") && p.endsWith("**")) return <b key={i}>{p.slice(2, -2)}</b>;
    return <span key={i}>{p}</span>;
  });
}

function renderMd(body: string): ReactNode[] {
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) {
      out.push(
        <ul key={out.length}>
          {list.map((t, i) => (
            <li key={i}>{inline(t)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  body.split("\n").forEach((l) => {
    if (l.startsWith("## ")) {
      flush();
      out.push(<h3 key={out.length}>{inline(l.slice(3))}</h3>);
    } else if (l.startsWith("# ")) {
      flush();
      out.push(<h3 key={out.length}>{inline(l.slice(2))}</h3>);
    } else if (l.startsWith("- ")) {
      list.push(l.slice(2));
    } else if (l.trim() === "") {
      flush();
    } else {
      flush();
      out.push(<p key={out.length}>{inline(l)}</p>);
    }
  });
  flush();
  return out;
}

export default function SkillView({ docs, skill }: { docs: SkillDoc[]; skill: SkillFile }) {
  const [id, setId] = useState(docs[0]?.id || "");
  const doc = useMemo(() => docs.find((d) => d.id === id) || docs[0], [docs, id]);

  return (
    <div className="content">
      <div className="head">
        <div className="hicon">
          <GraduationCap size={24} strokeWidth={1.6} />
        </div>
        <div>
          <div className="t">
            <h1>Skill</h1>
            <span className="pill">v{skill.skillVersion || "—"}</span>
          </div>
          <p>求职规范 · 只读加载 docs/skill/ 当前文档；规则修改需单独授权开发任务，日常求职只提交 inbox</p>
        </div>
      </div>
      <div className="skillwrap">
        <div className="panel snav">
          {docs.map((d) => (
            <button key={d.id} className={`sdoc${d.id === doc?.id ? " on" : ""}`} onClick={() => setId(d.id)}>
              <b>{d.title}</b>
              <small>{d.id}</small>
            </button>
          ))}
          {!docs.length && <div className="empty">No skill docs.</div>}
        </div>
        <div className="panel scontent">{doc ? renderMd(doc.body) : <div className="empty">Pick a doc.</div>}</div>
      </div>
    </div>
  );
}
