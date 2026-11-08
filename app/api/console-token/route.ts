import { dataRoot } from "../../../lib/data-root.ts";
import { checkConsoleOrigin, getConsoleToken } from "../../../lib/console-protection.ts";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const checked = checkConsoleOrigin(req);
  if (!checked.ok) return Response.json({ error: checked.reason }, { status: 403 });
  try { return Response.json({ token: getConsoleToken(dataRoot()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "console-token-unavailable" }, { status: 503 }); }
}
