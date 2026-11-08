"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import MuseHatchSettings from "./MuseHatchSettings";
import { Settings, Copy, RefreshCw } from "lucide-react";
import type { MuseEnvironment, MuseProbe } from "../../lib/muse-environment";
import { museCommands } from "../../lib/muse-commands";
import { STAGES } from "../../lib/activity-display";
import { fetchJson, pollInForeground } from "../../lib/polling";

const card: CSSProperties = { border: "1px solid #dbe7f3", borderRadius: 14, padding: 22, background: "#fff", marginBottom: 18 };
const input: CSSProperties = { width: "100%", boxSizing: "border-box", padding: "10px 12px", border: "1px solid #dbe7f3", borderRadius: 8, marginTop: 6, fontSize: 14 };
async function post(body: unknown) {
  const { token } = await fetchJson<{ token: string }>("/api/console-token", new AbortController().signal);
  const response = await fetch("/api/settings/muse", { method: "POST", headers: { "Content-Type": "application/json", "x-console-token": token }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败");
  return data;
}

function MuseCodeSettings() {
  const [environment, setEnvironment] = useState<MuseEnvironment | null>(null);
  const [binary, setBinary] = useState("");
  const [probe, setProbe] = useState<MuseProbe | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stage, setStage] = useState("screening");
  const [taskFile, setTaskFile] = useState("");
  useEffect(() => {
    const abort = new AbortController();
    fetchJson<MuseEnvironment>("/api/settings/muse", abort.signal).then(data => { setEnvironment(data); setBinary(data.settings.museBinary); setTaskFile(`${data.actualProjectRoot}/task.md`); }).catch(e => { if (!abort.signal.aborted) setError(String(e)); });
    return () => abort.abort();
  }, []);
  useEffect(() => {
    if (!pending) return;
    const poller = pollInForeground(async signal => {
      try {
        const data = await fetchJson<{ receipt: { status: string; summary: string } }>(`/api/receipts/${encodeURIComponent(pending)}`, signal);
        if (!["committed", "verified", "rejected", "failed"].includes(data.receipt.status)) return;
        if (["rejected", "failed"].includes(data.receipt.status)) { if (!signal.aborted) { setPending(null); setError(data.receipt.summary); } return; }
        const current = await fetchJson<MuseEnvironment>("/api/settings/muse", signal);
        if (signal.aborted) return;
        setEnvironment(current); setBinary(current.settings.museBinary); setProbe(null); setNotice("Engine 已保存绑定。可以检查环境并复制安装命令。"); setPending(null);
      } catch { /* Keep the queued request visible until its Receipt is available. */ }
    }, 2000);
    return poller.stop;
  }, [pending]);
  const saved = environment?.settings;
  const dirty = !!saved && binary !== saved.museBinary;
  async function save() {
    if (!environment) return;
    setBusy(true); setError(""); setNotice("");
    try { const result = await post({ projectRoot: environment.actualProjectRoot, museBinary: binary, expectedVersion: environment.settings.version }); setPending(result.taskId); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function check() {
    setBusy(true); setError("");
    try {
      const result = await post({ action: "check" });
      const current = await fetchJson<MuseEnvironment>("/api/settings/muse", new AbortController().signal);
      setEnvironment(current); setProbe(result);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice("命令已复制，请在本机终端审查后执行。"); }
    catch { setError("无法访问剪贴板，请直接选择命令复制。"); }
  }
  const commands = environment ? museCommands(environment.actualProjectRoot, environment.settings.museBinary, stage, taskFile) : null;
  return <div className="content" style={{ maxWidth: 1080 }}>
    <div className="head"><div className="hicon"><Settings size={24} strokeWidth={1.6} /></div><div><h1>Settings</h1><p style={{ color: "#64748b", marginTop: 5 }}>以下仅适用于另一个本机 Muse Code CLI，不适用于 Hatch。</p></div></div>
    {error && <p role="alert" style={{ color: "#b42318" }}>{error}</p>}
    {notice && <p role="status" style={{ color: "#1a7f37" }}>{notice}</p>}
    {!environment ? <p>{error ? "暂时无法读取配置。原配置保留。" : "正在读取本机配置…"}</p> : <>
      <section style={card} aria-label="接入状态">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 20 }}>
          <div><small>项目绑定</small><p><b>{!environment.bindingMatches ? "路径已变化，需重新绑定" : saved!.version > 0 ? `已保存 · v${saved!.version}` : "待保存确认"}</b></p></div>
          <div><small>Muse 配置检查</small><p><b>{!probe ? "尚未检查" : probe.hooksApproved && probe.skillRegistered && probe.version ? "入口与钩子配置有效" : "需要处理"}</b></p></div>
          <div><small>上下文加载信号</small><p><b>{environment.signals.context ? "曾收到会话启动信号" : "尚未收到"}</b></p>{environment.signals.context && <small>{environment.signals.context}</small>}</div>
          <div><small>工具执行信号</small><p><b>{environment.signals.tools ? "曾收到真实工具信号" : "尚未收到"}</b></p>{environment.signals.tools && <small>{environment.signals.tools}</small>}</div>
        </div>
        <p style={{ color: "#64748b", fontSize: 13 }}>配置成功后，需要从下方入口启动新任务。历史信号不代表 Muse 此刻正在运行，也不证明模型已理解规则。</p>
        {environment.signals.error && <p role="alert">{environment.signals.error}</p>}
      </section>
      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>1. 绑定执行环境</h2>
        <label>JobPipe 项目目录<input style={input} value={environment.actualProjectRoot} readOnly /></label>
        <p style={{ color: "#64748b", fontSize: 13 }}>使用当前服务的项目目录。迁移项目后重新打开 Settings 生成绑定，避免误切换真实业务数据。</p>
        <label>Muse 可执行文件<input style={input} value={binary} onChange={e => { setBinary(e.target.value); setProbe(null); }} placeholder="Muse 的绝对路径" spellCheck={false} /></label>
        <p style={{ color: "#64748b", fontSize: 13 }}>优先使用已安装的原生二进制，检查时只调用版本与插件清单，不启动模型。</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" disabled={busy || !!pending || !binary.startsWith("/")} onClick={save}>保存绑定</button>
          <button className="btn" disabled={busy || !!pending || dirty} onClick={check}><RefreshCw size={14} /> {busy ? "处理中…" : "检查环境"}</button>
        </div>
        {pending && <p role="status">已进入 Engine 队列，等待 Receipt：<code>{pending}</code>。请确保 Engine 正在运行；此时尚未保存。</p>}
        <ul>{environment.files.map(f => <li key={f.file}>{f.exists ? "✓" : "缺失"} <code>{f.file}</code></li>)}</ul>
        {!environment.executableExists && <p style={{ color: "#b42318" }}>已记录路径不可执行，请更新 Muse 路径并保存。</p>}
        {probe && <div><p>{probe.version ?? "版本未知"} · 检查时间 {probe.checkedAt}</p>{probe.problems.map(p => <p key={p} style={{ color: "#92400e" }}>{p}</p>)}</div>}
      </section>
      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>2. 注册 Muse 入口</h2>
        <p>在 Muse 中注册一个轻量 Skill，定位本项目并读取最新 AGENTS.md 与协议。业务规则始终以项目中的原文件为准。</p>
        <p style={{ color: "#64748b", fontSize: 13 }}>以下命令基于已提交的绑定。先保存路径，再在终端审查并执行安装及授权；安装使用临时工作目录，不改动 Muse 的项目默认目录。</p>
        <textarea aria-label="Muse 安装与授权命令" readOnly value={commands!.setup} style={{ ...input, fontFamily: "monospace", minHeight: 155 }} />
        <button className="btn" disabled={dirty || !!pending} onClick={() => copy(commands!.setup)}><Copy size={14} /> 复制配置命令</button>
      </section>
      <section style={card}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>3. 从绑定项目启动任务</h2>
        <label>执行环节<select value={stage} style={{ ...input, marginBottom: 14 }} onChange={e => setStage(e.target.value)}>{STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>任务文档绝对路径<input style={input} value={taskFile} onChange={e => setTaskFile(e.target.value)} spellCheck={false} /></label>
        <p style={{ color: "#64748b", fontSize: 13 }}>先准备任务文档，不要填写密码。启动命令固定项目工作目录、加载上下文，并关联 Activity。投递仍须经过用户审批。</p>
        <textarea aria-label="任务启动命令" readOnly value={commands!.start} style={{ ...input, minHeight: 90, fontFamily: "monospace" }} />
        <button className="btn" disabled={dirty || !!pending || !taskFile.startsWith("/") || /[\r\n\0]/.test(taskFile)} onClick={() => copy(commands!.start)}><Copy size={14} /> 复制启动命令</button>
        <p><a href="/activity">打开 Activity 查看真实运行信号 →</a></p>
      </section>
      <details style={card}><summary>撤销接入与长期记忆</summary><p>撤销钩子授权可执行以下命令。它不删除 JobPipe 的历史业务记录。</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{commands!.revoke}</pre><p>账号创建方式、凭证管理器引用等通过 Knowledge 保存为带 agent-context 标签的非秘密条目；新任务会加载有效条目。</p><a href="/knowledge">管理 Knowledge →</a></details>
    </>}
  </div>;
}

export default function SettingsView() {
  const [legacyOpen, setLegacyOpen] = useState(false);
  return <div className="content" style={{ maxWidth: 1080 }}>
    <div className="head"><div className="hicon"><Settings size={24} strokeWidth={1.6} /></div><div><h1>Settings</h1><p>配置 Muse 与 JobPipe 的连接、上下文和上报入口。</p></div></div>
    <MuseHatchSettings />
    <details onToggle={event => setLegacyOpen(event.currentTarget.open)}><summary>可选：Muse Code CLI（不同于 Hatch Muse）</summary>{legacyOpen && <MuseCodeSettings />}</details>
  </div>;
}
