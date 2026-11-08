import { dataRoot } from "../../../lib/data-root.ts";
import { listPlans } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only form plans (execution protocol stage B), newest first, all versions. */
export async function GET() {
  const baseDir = dataRoot();
  return Response.json({ plans: listPlans(baseDir) }, { headers: { "Cache-Control": "no-store" } });
}
