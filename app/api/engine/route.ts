import { dataRoot } from "../../../lib/data-root.ts";
import { loadEngineStatus } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only engine status: heartbeat, validation, external modifications, today's row. */
export async function GET() {
  const baseDir = dataRoot();
  return Response.json(loadEngineStatus(baseDir), { headers: { "Cache-Control": "no-store" } });
}
