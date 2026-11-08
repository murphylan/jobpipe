#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dataRoot } from "../lib/data-root.ts";
import { publishEvent } from "../lib/agent/publish.ts";
import { runWithActivity } from "../lib/agent/run.ts";
const args = process.argv.slice(2);
const flag = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
try {
  const base = flag("--base") ?? dataRoot();
  if (args[0] === "emit") {
    const file = flag("--input");
    if (!file) throw new Error("emit --input <event.json> [--base <root>]; omit createdAt to use machine UTC");
    const event = publishEvent(base, JSON.parse(readFileSync(file, "utf8")));
    console.log(JSON.stringify({ queued: true, taskId: event.taskId, createdAt: event.createdAt }));
  } else if (args[0] === "run") {
    const separator = args.indexOf("--");
    if (separator < 0) throw new Error("run --stage <stage> --title <title> [--job-id <id>] [--activity-id <id>] [--restart-of <runId>] [--refs <receipt,...>] -- <actual-command> [args]");
    const result = await runWithActivity({ base, command: args.slice(separator + 1), title: flag("--title") ?? "", stage: flag("--stage") ?? "", jobId: flag("--job-id"), activityId: flag("--activity-id"), restartOf: flag("--restart-of"), refs: flag("--refs")?.split(",") });
    process.exitCode = result.code;
    console.log(JSON.stringify(result));
  } else throw new Error("Use agent-events.ts emit or run; this tool only writes inbox and never starts Engine");
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
