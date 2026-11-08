import { dataRoot } from "../../../lib/data-root.ts";
import { listRuns } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

export const PAGE_SIZE = 15;

/** Read-only run list, newest first. Query: ?page=N (default 1), ?status=<status> to filter. */
export async function GET(req: Request) {
  const baseDir = dataRoot();
  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const status = url.searchParams.get("status");
  const all = listRuns(baseDir);
  const filtered = status ? all.filter((r) => r.status === status) : all;
  const start = (page - 1) * PAGE_SIZE;
  return Response.json(
    { runs: filtered.slice(start, start + PAGE_SIZE), total: filtered.length, page, pageSize: PAGE_SIZE },
    { headers: { "Cache-Control": "no-store" } },
  );
}
