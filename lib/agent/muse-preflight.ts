import { MUSE_EVENTS } from "./muse-hooks.ts";

export function assertMuseIntegration(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Muse plugin inventory unavailable");
  const p = input as { valid?: boolean; active?: boolean; record?: { enabled?: boolean }; runtime_capabilities?: { candidate: { stable_id: string }; status: string }[]; capability_diagnostics?: unknown[] };
  if (!p.valid || !p.active || !p.record?.enabled || p.capability_diagnostics?.length) throw new Error("Muse plugin inactive or inventory unavailable; inspect jobpipe-observer");
  for (const event of MUSE_EVENTS) {
    if (!p.runtime_capabilities?.some(c => c.candidate.stable_id === `plugin:jobpipe-observer:hook:${event.toLowerCase()}` && c.status === "trusted_enabled"))
      throw new Error(`Muse hook ${event} not approved; install and approve jobpipe-observer before running`);
  }
}
