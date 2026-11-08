import { dataRoot } from "../../../lib/data-root.ts";
import { loadFullSnapshotData } from "../../../lib/datafiles";
import { loadSnapshot } from "../../../lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = loadSnapshot();
  const headers = { "Cache-Control": "no-store" };
  if (new URL(req.url).searchParams.get("v") === s.version)
    return Response.json({ unchanged: true, version: s.version, generatedAt: s.generatedAt }, { headers });
  return Response.json({ ...s, ...loadFullSnapshotData(dataRoot()) }, { headers });
}
