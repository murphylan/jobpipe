import { dataRoot } from "../../../lib/data-root.ts";
import { readJsonFile } from "../../../lib/datafiles";

// GET /api/muse-live — 读取 Muse 实时状态（引擎写的 data/muse-live.json，只读）
// 写路径：Muse 写 data/.inbox/muse-live/<jobId>.json → daemon watcher 提升为正式文件

export const dynamic = "force-dynamic";

type MuseLiveFile = {
  version: number;
  updatedAt: string;
  live: Record<string, { state: "working" | "waiting_user"; detail: string; updatedAt: string }>;
};

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  const data = readJsonFile<MuseLiveFile>(dataRoot(), "muse-live.json", {
    version: 0,
    updatedAt: "",
    live: {},
  });
  return Response.json(data, { headers });
}
