import { dataRoot } from "../../../../lib/data-root.ts";
import { isSafeTaskId, readRunDetail } from "../../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only single run plus its receipt. Unsafe ids are 400, unknown ids are 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const baseDir = dataRoot();
  const { id } = await ctx.params;
  if (!isSafeTaskId(id)) return Response.json({ error: "invalid-taskId" }, { status: 400 });
  const detail = readRunDetail(baseDir, id);
  if (!detail.run && !detail.receipt) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json(detail, { headers: { "Cache-Control": "no-store" } });
}
