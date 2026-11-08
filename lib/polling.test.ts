import { afterEach, expect, it, vi } from "vitest";
import { createPoller, fetchJson, pollInForeground } from "./polling";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
it("does not overlap slow polls and waits two seconds after completion", async () => {
  vi.useFakeTimers(); const wait = deferred<void>(); const task = vi.fn(() => wait.promise);
  const poller = createPoller(task, 2000); await vi.advanceTimersByTimeAsync(10000); expect(task).toHaveBeenCalledTimes(1);
  wait.resolve(); await vi.advanceTimersByTimeAsync(1999); expect(task).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(task).toHaveBeenCalledTimes(2); poller.stop();
});
it("foreground refresh invalidates a slow response even when transport ignores abort", async () => {
  vi.useFakeTimers(); const old = deferred<Response>(); let calls = 0; let value = "";
  vi.stubGlobal("fetch", vi.fn(() => ++calls === 1 ? old.promise : Promise.resolve(Response.json({ value: "new" }))));
  const poller = createPoller(async signal => { const j = await fetchJson<{ value: string }>("/data", signal); if (!signal.aborted) value = j.value; }, 2000);
  await vi.advanceTimersByTimeAsync(0); poller.refresh(); await vi.advanceTimersByTimeAsync(0); expect(value).toBe("new");
  old.resolve(Response.json({ value: "old" })); await vi.advanceTimersByTimeAsync(0); expect(value).toBe("new"); poller.stop();
});
it("stop aborts pending work and prevents later requests", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal; const task = vi.fn(async s => { signal = s; });
  const poller = createPoller(task, 2000); await vi.advanceTimersByTimeAsync(0); poller.stop();
  expect(signal.aborted).toBe(true); await vi.advanceTimersByTimeAsync(20000); expect(task).toHaveBeenCalledTimes(1);
});
it("poll failures are retried without overlapping timers", async () => {
  vi.useFakeTimers(); const task = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  const poller = createPoller(task, 2000); await vi.advanceTimersByTimeAsync(2000); expect(task).toHaveBeenCalledTimes(2); poller.stop();
});
it("focus, visible return and online refresh immediately and cleanup removes listeners", async () => {
  vi.useFakeTimers(); const doc = Object.assign(new EventTarget(), { visibilityState: "visible" }); const win = new EventTarget();
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win); const task = vi.fn(async () => {});
  const poller = pollInForeground(task, 2000); await vi.advanceTimersByTimeAsync(0);
  for (const name of ["focus", "online"]) { win.dispatchEvent(new Event(name)); await vi.advanceTimersByTimeAsync(0); }
  doc.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); expect(task).toHaveBeenCalledTimes(4);
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange")); await vi.advanceTimersByTimeAsync(0); expect(task).toHaveBeenCalledTimes(4);
  poller.stop(); doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); win.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10000); expect(task).toHaveBeenCalledTimes(4);
});
it("HTTP failures are not treated as valid snapshots", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "server" }, { status: 503 })));
  await expect(fetchJson("/data", new AbortController().signal)).rejects.toThrow("503");
});
