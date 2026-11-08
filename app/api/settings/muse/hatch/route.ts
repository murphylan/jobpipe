import { dataRoot } from "../../../../../lib/data-root.ts";
import { readHatchEnvironment } from "../../../../../lib/muse-hatch.ts";
export const dynamic = "force-dynamic";
export async function GET() {
  return Response.json(readHatchEnvironment(dataRoot()), { headers: { "Cache-Control": "no-store" } });
}
