"use client";
import { useEffect, useState } from "react";
import type { readHatchEnvironment } from "../../lib/muse-hatch";
import { fetchJson } from "../../lib/polling";
const card = { background: "#fff", border: "1px solid #dbe7f3", borderRadius: 12, padding: 20, marginBottom: 16 };
export default function MuseHatchSettings() {
  const [environment, setEnvironment] = useState<ReturnType<typeof readHatchEnvironment> | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); fetchJson<ReturnType<typeof readHatchEnvironment>>("/api/settings/muse/hatch", controller.signal).then(setEnvironment).catch(() => { if (!controller.signal.aborted) setError("接入信息读取失败"); }); return () => controller.abort(); }, []);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setNotice("已复制，请发给实际的 Muse 执行。"); } catch { setError("复制失败，请直接选择文本复制。"); } };
  return <>
    <p>当前执行端：Hatch Muse。JobPipe 只运行本地看板和 Engine，通过设备文件通道交换事件与收据。</p>
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    {!environment ? <p>正在读取接入信息…</p> : <>
      <section style={card}><h2>接入状态</h2><p>Mac 工程：<code>{environment.projectRoot}</code></p><p>工程接入包：{environment.packageReady ? "已就绪，仍需 Muse 安装并加载" : "文件缺失，请修复"}</p><p>最近上下文确认：{environment.lastContext ? environment.lastContext.at : "尚未收到，不代表已连接"}</p>{environment.lastContext && <p style={{ overflowWrap: "anywhere", fontSize: 12 }}>digest：{environment.lastContext.digest}</p>}<p>历史确认不代表当前正在执行；Muse 的 Linux 默认目录与 Mac 工程路径分开处理。</p>{environment.problem && <p role="alert">{environment.problem}</p>}</section>
      <section style={card}><h2>1. 建立 Muse 的规则入口</h2><p>把下面的指令交给 Muse，在它自己的默认目录建立轻量入口。项目业务规则保持单一来源。</p><textarea aria-label="Hatch Muse 接入指令" readOnly value={environment.installText} rows={8} style={{ width: "100%", boxSizing: "border-box" }} /><button className="btn" onClick={() => copy(environment.installText)} disabled={!environment.packageReady}>复制接入指令</button></section>
      <section style={card}><h2>2. 开始实际任务</h2><p>将下面的启动说明与实际任务一起发送给 Muse。上下文成功加载后，执行进度在 Activity 查看；长期约定通过 Knowledge 保存。</p><textarea aria-label="Hatch Muse 任务启动说明" readOnly value={environment.taskText} rows={6} style={{ width: "100%", boxSizing: "border-box" }} /><button className="btn" onClick={() => copy(environment.taskText)}>复制任务启动说明</button><p><a href="/activity">Activity</a> · <a href="/knowledge">Knowledge</a></p></section>
    </>}
  </>;
}
