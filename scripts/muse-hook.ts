#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { handleMuseHook } from "../lib/agent/muse-hooks.ts";
try {
  if (!process.env.JOBPIPE_MUSE_REPORT || !process.env.JOBPIPE_MUSE_CONTEXT_FILE) throw new Error("Use JobPipe Muse launcher: execution context/report identity missing");
  handleMuseHook(process.argv[2], JSON.parse(readFileSync(0, "utf8")), JSON.parse(process.env.JOBPIPE_MUSE_REPORT), process.env.JOBPIPE_MUSE_CONTEXT_FILE);
  // No guessed additionalContext stdout protocol. Context is supplied via --prompt-file.
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; }
