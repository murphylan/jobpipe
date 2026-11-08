import { enqueueKnowledge } from "../../../lib/knowledge-inbox.ts";
import { dataRoot } from "../../../lib/data-root.ts";
import { searchKnowledge } from "../../../lib/knowledge.ts";

export const dynamic = "force-dynamic";

/**
 * GET /api/knowledge?q=<query>&archived=<true|false>
 * List knowledge entries (FR-27: 检索).
 */
export async function GET(req: Request) {
  const baseDir = dataRoot();
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const archivedParam = url.searchParams.get("archived");
  let entries;
  try { entries = searchKnowledge(baseDir, q); } catch { return Response.json({ error: "knowledge-corrupt" }, { status: 503 }); }
  const filtered = archivedParam === "true"
    ? entries.filter((e: { archived: boolean }) => e.archived)
    : archivedParam === "false"
      ? entries.filter((e: { archived: boolean }) => !e.archived)
      : entries;
  return Response.json({ entries: filtered }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * POST /api/knowledge
 * Body: { title, body, tags? } - Add a new entry (FR-27: 添加).
 * Body: { action: "update", id, expectedUpdatedAt, title, body, tags? } - Create a revision and archive the prior entry.
 * Body: { action: "reread", taskId? } - Log a Muse re-read (FR-27: 重读记录).
 */
export async function POST(req: Request) {
  const baseDir = dataRoot();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  const queued = enqueueKnowledge(baseDir, body);
  return queued ? Response.json(queued, { status: 202 }) : Response.json({ error: "invalid knowledge request" }, { status: 400 });
}
