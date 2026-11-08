import { dataRoot } from "../../../lib/data-root.ts";
import { listAttempts, listCheckpoints } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only submission attempts + read-back checkpoints (execution protocol stage C), newest first. */
export async function GET() {
  const baseDir = dataRoot();
  return Response.json(
    { attempts: listAttempts(baseDir), checkpoints: listCheckpoints(baseDir) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
