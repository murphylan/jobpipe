/** Serial polling. A refresh invalidates and aborts the previous generation. */
export function createPoller(task: (signal: AbortSignal) => Promise<void>, intervalMs: number) {
  let stopped = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const refresh = () => {
    if (stopped) return;
    clearTimeout(timer);
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    const current = ++generation;
    void Promise.resolve().then(() => { if (!signal.aborted) return task(signal); }).catch(() => {
      // Consumers report fetch failures; never leave an unhandled rejection.
    }).finally(() => {
      if (!stopped && current === generation) timer = setTimeout(refresh, intervalMs);
    });
  };
  const stop = () => { stopped = true; generation++; clearTimeout(timer); controller?.abort(); };
  refresh();
  return { refresh, stop };
}

/** Refresh promptly on return to the tab or network, and remove every listener. */
export function pollInForeground(task: (signal: AbortSignal) => Promise<void>, intervalMs: number) {
  const poller = createPoller(task, intervalMs);
  const visible = () => { if (document.visibilityState === "visible") poller.refresh(); };
  document.addEventListener("visibilitychange", visible);
  window.addEventListener("focus", visible);
  window.addEventListener("online", visible);
  return { refresh: poller.refresh, stop: () => {
    poller.stop(); document.removeEventListener("visibilitychange", visible);
    window.removeEventListener("focus", visible); window.removeEventListener("online", visible);
  } };
}

export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const value = await response.json();
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  return value as T;
}
