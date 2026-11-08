#!/usr/bin/env node
import { initializeWorkspace } from "../lib/engine/initialize.ts";
import { recoverJournals } from "../lib/engine/journal.ts";
import { withEngineLock } from "../lib/engine/lock.ts";
import { dataRoot } from "../lib/data-root.ts";
// Engine CLI, stage 1 scope only (Doc-00 section 9).
// Run with: npm run engine -- <command>  (Node 22 type stripping;
// no new dependency. Relative imports in the engine graph use
// explicit .ts extensions so Node can resolve them directly;
// tsconfig sets allowImportingTsExtensions for the same reason.)
// Commands in this cut:
//   validate [baseDir]          validate data/ and print the result
//   expand --dry-run --changeset <file> [--base <dir>] [--today <date>]
//                               dry-run APPLICATION_SUBMITTED only
// Anything that would actually write data is refused here:
// real application lands with the inbox/receipt/commit stages.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { heartbeatStatus, processInboxOnce } from "../lib/engine/daemon.ts";
import { deriveDaily, detectExternalModifications } from "../lib/engine/external.ts";
import { shadowCompare, shadowReportPath } from "../lib/engine/shadow.ts";
import { computeShadowStats } from "../lib/engine/shadow-stats.ts";
import { switchEvent, switchBackEvent, listSwitches, isSwitched } from "../lib/engine/switch.ts";
import { enableForceMode, disableForceMode, isForceModeEnabled, checkForceMode } from "../lib/engine/force-mode.ts";
import { runDaemonLoop } from "../lib/engine/run-daemon.ts";
import { expandApplicationSubmitted, type ChangeSetInput } from "../lib/engine/expand.ts";
import { validateDataDir } from "../lib/engine/validate.ts";

function usage(): string {
  return [
    "Usage:",
    "  npm run engine -- init [baseDir]   (fresh empty workspace only)",
    "  npm run engine -- validate [baseDir]",
    "  npm run engine -- expand --dry-run --changeset <file> [--base <dir>] [--today <date>]",
    "  npm run engine -- shadow --changeset <file> --snapshot <dir> [--base <dir>]",
    "  npm run engine -- shadow-stats [--base <dir>]",
    "  npm run engine -- switch --event <name> [--by <who>] [--reason <why>] [--base <dir>]",
    "  npm run engine -- switch-back --event <name> [--by <who>] [--reason <why>] [--base <dir>]",
    "  npm run engine -- switches [--base <dir>]",
    "  npm run engine -- force-mode <on|off|status> [--by <who>] [--reason <why>] [--base <dir>]",
    "  npm run engine -- heartbeat [baseDir]",
    "  npm run engine -- daemon --once [--base <dir>]",
    "  npm run engine -- daemon [--base <dir>]  (loop until SIGINT/SIGTERM)",
    "  npm run engine -- preflight <jobId> [--base <dir>]",
    "  npm run engine -- receipt <taskId> [--base <dir>]",
  ].join("\n");
}

function flagValue(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

// Some package managers forward the script separator instead of consuming it.
const args = process.argv.slice(2);
while (args[0] === "--") args.shift();
const command = args[0];

if (command === "init") {
  try { console.log(JSON.stringify(initializeWorkspace(args[1] ?? dataRoot()), null, 2)); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
} else if (command === "validate") {
  const baseDir = args[1] ?? dataRoot();
  const result = validateDataDir(baseDir);
  console.log(JSON.stringify(result, null, 2));
  if (result.errors.length) {
    console.error(`${result.errors.length} validation error(s)`);
    process.exitCode = 1;
  }
} else if (command === "expand") {
  if (!args.includes("--dry-run")) {
    console.error("Refused: stage 1 CLI supports dry-run only. Add --dry-run.");
    process.exitCode = 2;
  } else {
    const changesetPath = flagValue(args, "--changeset");
    if (!changesetPath) {
      console.error("Missing --changeset <file>");
      console.error(usage());
      process.exitCode = 2;
    } else {
      const baseDir = flagValue(args, "--base") ?? dataRoot();
      const today = flagValue(args, "--today") ?? undefined;
      const changeset = JSON.parse(readFileSync(changesetPath, "utf-8")) as ChangeSetInput;
      const result = expandApplicationSubmitted(baseDir, changeset, today ? { today } : {});
      console.log(JSON.stringify(result, null, 2));
      console.log("DRY RUN: no files were written.");
      if (!result.ok) process.exitCode = 1;
    }
  }
} else if (command === "shadow") {
  const changesetFile = flagValue(args, "--changeset");
  const snapshotDir = flagValue(args, "--snapshot");
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  if (!changesetFile || !snapshotDir) {
    console.error("shadow needs --changeset <file> --snapshot <dir> [--base <dir>]");
    process.exitCode = 2;
  } else {
    const changeset = JSON.parse(readFileSync(changesetFile, "utf-8"));
    const report = shadowCompare(snapshotDir, baseDir, changeset);
    mkdirSync(path.dirname(shadowReportPath(baseDir, report.taskId)), { recursive: true });
    writeFileSync(shadowReportPath(baseDir, report.taskId), JSON.stringify(report, null, 2) + "\n", "utf-8");
    console.log(JSON.stringify(report, null, 2));
  }
} else if (command === "shadow-stats") {
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  const stats = computeShadowStats(baseDir);
  console.log(JSON.stringify(stats, null, 2));
  // Human-readable summary.
  console.log("\n--- M-7 Shadow Reconciliation Status ---");
  if (stats.events.length === 0) {
    console.log("No shadow reports found. Run: npm run engine -- shadow --changeset <file> --snapshot <dir>");
  } else {
    for (const e of stats.events) {
      const status = e.met ? "✓ READY" : "○";
      console.log(`${status} ${e.event}: ${e.consecutiveZeroDiff}/${e.required} consecutive zero-diffs (total ${e.totalReports} reports)`);
    }
    console.log(stats.allMet ? "\nM-7 MET: all events ready for cutover." : "\nM-7 NOT MET: continue shadow runs.");
  }
} else if (command === "switch") {
  const event = flagValue(args, "--event");
  const by = flagValue(args, "--by") ?? "user";
  const reason = flagValue(args, "--reason") ?? "manual cutover";
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  if (!event) {
    console.error("switch needs --event <name> [--by <who>] [--reason <why>] [--base <dir>]");
    process.exitCode = 2;
  } else {
    const result = withEngineLock(baseDir, () => switchEvent(baseDir, event, by, reason));
    if (!result.ok) {
      console.error(`Switch failed: ${result.error}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ ${event} switched to engine-only writes.`);
      console.log(JSON.stringify(result.record, null, 2));
    }
  }
} else if (command === "switch-back") {
  const event = flagValue(args, "--event");
  const by = flagValue(args, "--by") ?? "user";
  const reason = flagValue(args, "--reason") ?? "manual rollback";
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  if (!event) {
    console.error("switch-back needs --event <name> [--by <who>] [--reason <why>] [--base <dir>]");
    process.exitCode = 2;
  } else {
    const result = withEngineLock(baseDir, () => switchBackEvent(baseDir, event, by, reason));
    if (!result.ok) {
      console.error(`Switch-back failed: ${result.error}`);
      process.exitCode = 1;
    } else {
      console.log(`✓ ${event} switched back (direct writes allowed).`);
      console.log(JSON.stringify(result.record, null, 2));
    }
  }
} else if (command === "switches") {
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  const switches = listSwitches(baseDir);
  console.log(JSON.stringify(switches, null, 2));
  console.log("\n--- Cutover Status ---");
  if (switches.length === 0) {
    console.log("No events switched. All events allow direct writes (shadow mode).");
  } else {
    for (const s of switches) {
      const status = s.switched ? "🔒 ENGINE-ONLY" : "○ direct writes allowed";
      console.log(`${status} ${s.event} (switched ${s.switchedAt} by ${s.switchedBy})`);
    }
  }
} else if (command === "force-mode") {
  const action = args[1]; // on, off, status
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  const by = flagValue(args, "--by") ?? "user";
  const reason = flagValue(args, "--reason") ?? "manual";
  if (action === "on") {
    withEngineLock(baseDir, () => enableForceMode(baseDir, by, reason));
    console.log("✓ Force mode ENABLED. External modifications will block related ChangeSets.");
  } else if (action === "off") {
    withEngineLock(baseDir, () => disableForceMode(baseDir, by, reason));
    console.log("✓ Force mode DISABLED.");
  } else if (action === "status") {
    const enabled = isForceModeEnabled(baseDir);
    console.log(JSON.stringify({ enabled }, null, 2));
    console.log(enabled ? "Force mode is ON." : "Force mode is OFF.");
  } else {
    console.error("force-mode needs <on|off|status> [--by <who>] [--reason <why>] [--base <dir>]");
    process.exitCode = 2;
  }
} else if (command === "derive-daily") {
  const baseDir = args[1] ?? dataRoot();
  const result = withEngineLock(baseDir, () => { recoverJournals(baseDir); return deriveDaily(baseDir, new Date().toISOString()); });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
} else if (command === "external-check") {
  const baseDir = args[1] ?? dataRoot();
  console.log(JSON.stringify(detectExternalModifications(baseDir), null, 2));
} else if (command === "heartbeat") {
  const baseDir = args[1] ?? dataRoot();
  console.log(JSON.stringify(heartbeatStatus(baseDir), null, 2));
} else if (command === "daemon") {
  const baseDir = flagValue(args, "--base") ?? dataRoot();
  if (args.includes("--once")) {
    const results = processInboxOnce(baseDir);
    console.log(JSON.stringify(results, null, 2));
  } else {
    try {
      runDaemonLoop(baseDir);
      console.log(`Engine started (PID ${process.pid}). Keep this terminal open; Ctrl+C stops it.`);
    } catch (error) {
      if (error instanceof Error && error.message === "engine already running: data/.engine.lock is held") {
        let owner = "";
        try {
          const lock = JSON.parse(readFileSync(path.join(baseDir, "data/.engine.lock"), "utf8"));
          if (Number.isInteger(lock.pid) && lock.pid > 0) owner = ` (PID ${lock.pid})`;
        } catch { /* ownership unavailable; keep the lock intact */ }
        console.error(`Engine is already running or its lock is held${owner}. No second instance was started. Check with: npm run engine -- heartbeat`);
        console.error("Do not delete the lock while its owner is running. Stop the existing Engine in its terminal before restarting.");
        process.exitCode = 1;
      } else throw error;
    }
  }
} else if (command === "receipt") {
  // 2026-11-05: check receipt status for a taskId.
  // Usage: npm run engine -- receipt <taskId> [--base <dir>]
  const taskId = args[1];
  if (!taskId) {
    console.error("Usage: npm run engine -- receipt <taskId> [--base <dir>]");
    process.exitCode = 2;
  } else {
    const baseDir = flagValue(args, "--base") ?? dataRoot();
    const { checkReceipt } = await import("../lib/engine/receipt-check.ts");
    const result = checkReceipt(baseDir, taskId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.found) {
      console.error("Receipt not found. Event may not have been sent.");
      process.exitCode = 1;
    } else if (result.status === "rejected") {
      console.error("\nREJECTED. Errors:");
      for (const e of result.errors ?? []) console.error(`  - ${e}`);
      process.exitCode = 1;
    } else if (result.status === "pending") {
      console.log("\nPending: still in inbox, daemon hasn't processed yet.");
    } else {
      console.log("\nCommitted: event applied successfully.");
    }
  }
} else if (command === "preflight") {
  // 2026-11-05: pre-check a job for APPLICATION_SUBMITTED readiness.
  // Usage: npm run engine -- preflight <jobId> [--base <dir>]
  const jobId = args[1];
  if (!jobId) {
    console.error("Usage: npm run engine -- preflight <jobId> [--base <dir>]");
    process.exitCode = 2;
  } else {
    const baseDir = flagValue(args, "--base") ?? dataRoot();
    const { preflightApplicationSubmitted } = await import("../lib/engine/preflight.ts");
    const result = preflightApplicationSubmitted(baseDir, jobId);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) {
      console.error("\nPreflight FAILED. Fix the failed checks before submitting.");
      process.exitCode = 1;
    } else {
      console.log("\nPreflight PASSED. Ready for APPLICATION_SUBMITTED.");
    }
  }
} else {
  console.error(usage());
  process.exitCode = 2;
}
