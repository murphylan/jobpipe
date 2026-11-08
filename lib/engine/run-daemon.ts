import { acquireLock, releaseLock } from "./lock.ts";
import { processInboxOnce } from "./daemon.ts";
import { readHeartbeatStatus, writeHeartbeat } from "./heartbeat.ts";
import { readState, writeState } from "./state.ts";

/** Loop errors stay visible until a successful poll; stop is also usable by tests. */
export function runDaemonLoop(baseDir: string, opts: { pollMs?: number; heartbeatMs?: number } = {}): { stop: () => void } {
  if (!acquireLock(baseDir)) throw new Error("engine already running: data/.engine.lock is held");
  let stopped = false;
  let error: string | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  const cleanup = () => {
    clearInterval(pollTimer); clearInterval(heartbeatTimer);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    releaseLock(baseDir);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { writeHeartbeat(baseDir, "idle"); } finally { cleanup(); }
  };
  const pulse = () => writeHeartbeat(baseDir, error ? "error" : "running", error);
  const poll = () => {
    try { processInboxOnce(baseDir, { continuous: true }); error = readHeartbeatStatus(baseDir).error; }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    pulse();
  };
  try {
    if (!readState(baseDir)) writeState(baseDir, null);
    process.on("SIGINT", stop); process.on("SIGTERM", stop);
    poll();
    pollTimer = setInterval(poll, opts.pollMs ?? 2000);
    heartbeatTimer = setInterval(pulse, opts.heartbeatMs ?? 5000);
    return { stop };
  } catch (e) {
    cleanup();
    throw e;
  }
}
