import { dataRoot } from "../../../lib/data-root.ts";
import { readRegistryText } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only registry yaml text for the registry view. */
export async function GET() {
  const text = readRegistryText(dataRoot());
  if (text === null) return Response.json({ error: "not-found" }, { status: 404 });
  return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
}
