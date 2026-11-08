import { dataRoot } from "../../../lib/data-root.ts";
import { queryActivityFeed } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

export const PAGE_SIZE = 15;

/**
 * Filtered, sorted, paged activity feed plus its counts.
 * Query: ?page=N (default 1), ?sort=created-desc/created-asc/
 * status/kind, ?stage= (six pipeline stages), ?status=
 * (running/done/waiting/failed). Invalid values fall back
 * to no filter, never an error. Distribution covers the
 * stage-filtered full list, overview is Chicago-today
 * scoped; both ride along with the page slice.
 */
export async function GET(req: Request) {
  const baseDir = dataRoot();
  const url = new URL(req.url);
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const result = queryActivityFeed(baseDir, {
    sort: url.searchParams.get("sort") ?? undefined,
    stage: url.searchParams.get("stage"),
    status: url.searchParams.get("status"),
    page,
    pageSize: PAGE_SIZE,
    selectedId: url.searchParams.get("selectedId"),
  });
  return Response.json(
    { ...result, pageSize: PAGE_SIZE },
    { headers: { "Cache-Control": "no-store" } },
  );
}
