#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { buildExecutionContext } from "../lib/engine/execution-context.ts";
import { publishEvent } from "../lib/agent/publish.ts";
const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
try {
  const base = realpathSync(path.resolve(import.meta.dirname, ".."));
  if (args.includes("--help") || !args.length) {
    console.log(`Hatch Muse uses the Mac device file channel, not a local CLI executable.\nSkill source: ${path.join(base, "integrations/muse/hatch/jobpipe_executor")}\nRead docs/runbooks/muse-hatch.md or Settings for installation.\nOptional Mac-side preparation: npm run muse -- --stage <stage> --task-file <file> [--job-id <id>] [--queue]\nWithout --queue, only print context metadata; never starts Muse or Engine.`);
  } else {
    const taskFile = flag("--task-file"); if (!taskFile) throw new Error("--task-file required");
    const stage = flag("--stage") ?? "", task = readFileSync(taskFile, "utf8"), jobId = flag("--job-id");
    const context = buildExecutionContext(base, stage, task, jobId);
    if (args.includes("--queue")) {
      const queued = publishEvent(base, { event: "AGENT_CONTEXT_REQUESTED", payload: { sessionId: `muse-run-${randomUUID()}`, stage, task, ...(jobId ? { jobId } : {}) } });
      console.log(JSON.stringify({ queued: true, taskId: queued.taskId, contextFile: `data/agent-contexts/${queued.taskId}.json`, message: "Wait for the Engine Receipt, then let Muse read the context. Muse was not started." }));
    } else console.log(JSON.stringify({ workspace: base, stage, digest: context.digest, knowledgeAvailable: context.knowledgeAvailable, knowledgeVersion: context.knowledgeVersion, knowledgeCount: context.knowledge.length, queued: false }));
  }
} catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
