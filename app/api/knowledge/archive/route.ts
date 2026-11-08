import { enqueueKnowledge } from "../../../../lib/knowledge-inbox.ts";
import { dataRoot } from "../../../../lib/data-root.ts";
export const dynamic = "force-dynamic";

/**
 * POST /api/knowledge/archive
 * Body: { id, archived: true|false } - Archive or unarchive (FR-27: 归档不是删除).
 */
export async function POST(req: Request) {
  const baseDir = dataRoot();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const queued = enqueueKnowledge(baseDir, body, true);
  return queued ? Response.json(queued, { status: 202 }) : Response.json({ error: "invalid archive request" }, { status: 400 });
}
