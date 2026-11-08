"use client";

import { useEffect, useRef, useState } from "react";
import type { FullSnapshot } from "../lib/datafiles";
import { fetchJson, pollInForeground } from "../lib/polling";

/** One serial, cancellable source for every view; foreground return refreshes immediately. */
export function usePipeline(initial: FullSnapshot) {
  const [snap, setSnap] = useState(initial);
  const [synced, setSynced] = useState(initial.generatedAt);
  const [note, setNote] = useState("");
  const [offline, setOffline] = useState(false);
  const ref = useRef(snap);
  ref.current = snap;
  useEffect(() => {
    let noteTimer: ReturnType<typeof setTimeout> | undefined;
    const poller = pollInForeground(async signal => {
      try {
        const j = await fetchJson<FullSnapshot & { unchanged?: boolean }>(`/api/pipeline?v=${encodeURIComponent(ref.current.version)}`, signal);
        if (signal.aborted) return;
        setOffline(false); setSynced(j.generatedAt);
        if (!j.unchanged) {
          const seen = new Set(ref.current.ledger.map(r => r.id));
          const added = j.ledger.filter(r => !seen.has(r.id)).length;
          ref.current = j; setSnap(j);
          if (added) {
            setNote(`${added} new ledger row${added > 1 ? "s" : ""}`);
            clearTimeout(noteTimer); noteTimer = setTimeout(() => setNote(""), 8000);
          }
        }
      } catch { if (!signal.aborted) setOffline(true); }
    }, 2000);
    return () => { poller.stop(); clearTimeout(noteTimer); };
  }, []);
  return { snap, synced, offline, note };
}
