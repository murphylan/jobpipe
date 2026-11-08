#!/usr/bin/env node
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readMuseSettings } from "../lib/engine/muse-settings.ts";
import { buildExecutionContext } from "../lib/engine/execution-context.ts";
import { runWithActivity } from "../lib/agent/run.ts";
import { spawnSync } from "node:child_process";
import { assertMuseIntegration } from "../lib/agent/muse-preflight.ts";
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
let temp: string | undefined;
try {
  if (args.includes("--help")) {
    console.log("node scripts/muse-start.ts --stage <stage> --task-file <file> [--job-id <id>] [--muse-bin <binary>] [--preview] [--trust-workspace]");
  } else {
    const base = realpathSync(path.resolve(import.meta.dirname, ".."));
    const file = flag("--task-file");
    if (!file) throw new Error("--task-file required; task input must not contain secrets");
    const { readFileSync } = await import("node:fs");
    const context = buildExecutionContext(base, flag("--stage") ?? "", readFileSync(file, "utf8"), flag("--job-id"));
    if (args.includes("--preview")) console.log(JSON.stringify({ workspace: base, stage: context.stage, digest: context.digest, knowledgeVersion: context.knowledgeVersion, knowledgeCount: context.knowledge.length, omittedKnowledgeCount: context.omittedKnowledgeCount, plugin: path.join(base, "integrations/muse/jobpipe-observer") }, null, 2));
    else {
      if (!args.includes("--trust-workspace")) throw new Error("Pass --trust-workspace to explicitly load JobPipe workspace rules");
      const settings = readMuseSettings(base);
      if (settings.projectRoot !== base) throw new Error("Project binding changed; update Settings before running Muse");
      const binary = flag("--muse-bin") ?? settings.museBinary;
      const inventory = spawnSync(binary, ["plugins", "inspect", "jobpipe-observer", "--json"], { cwd: base, encoding: "utf8" });
      if (inventory.status !== 0) throw new Error("Muse plugin inspection failed; install integrations/muse/jobpipe-observer and approve its hooks first");
      assertMuseIntegration(JSON.parse(inventory.stdout));
      temp = mkdtempSync(path.join(tmpdir(), "jobpipe-muse-context-"));
      const promptFile = path.join(temp, "context.json");
      writeFileSync(promptFile, JSON.stringify(context, null, 2), { mode: 0o600 });
      const result = await runWithActivity({ base, stage: context.stage, title: "Muse 求职任务", jobId: flag("--job-id"), command: [binary, "exec", "--workspace", base, "--trust-workspace", "--prompt-file", promptFile], env: { JOBPIPE_MUSE_CONTEXT_FILE: promptFile, JOBPIPE_MUSE_ROOT: base }, muse: { contextFile: promptFile, projectRoot: base } });
      process.exitCode = result.code;
    }
  }
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
finally { if (temp) rmSync(temp, { recursive: true, force: true }); }
