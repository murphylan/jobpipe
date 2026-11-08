import { isObject } from "../../../lib/engine/envelope.ts";
import { dataRoot } from "../../../lib/data-root.ts";
import { checkConsoleOrigin, getConsoleToken, validConsoleToken } from "../../../lib/console-protection.ts";
import { listPending, writeDecision } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only pending-approval list for the approval center. */
export async function GET() {
  const baseDir = dataRoot();
  return Response.json({ pending: listPending(baseDir) }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The console's only write: a decision file in
 * data/inbox/decisions/. Body: { taskId, approved, quote }.
 * The engine applies it on its next poll; this endpoint
 * never touches a business data file and never claims the
 * change is applied.
 *
 * FR-21: Protected by Host/Origin/token checks. Forged
 * cross-site requests are rejected with 403.
 */
export async function POST(req: Request) {
  const baseDir = dataRoot();
  const prot = checkConsoleOrigin(req);
  if (!prot.ok) {
    return Response.json({ error: prot.reason }, { status: 403 });
  }
  try {
    if (!validConsoleToken(req.headers.get("x-console-token"), getConsoleToken(baseDir))) return Response.json({ error: "forbidden-token" }, { status: 403 });
  } catch { return Response.json({ error: "console-token-unavailable" }, { status: 503 }); }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!isObject(body)) return Response.json({ error: "invalid-body" }, { status: 400 });
  const input = body as { taskId?: unknown; approved?: unknown; quote?: unknown };
  const result = writeDecision(baseDir, { taskId: input.taskId, approved: input.approved, quote: input.quote });
  if (!result.ok) {
    const status =
      result.reason === "receipt-not-found"
        ? 404
        : result.reason === "not-pending" || result.reason === "already-decided"
          ? 409
          : 400;
    return Response.json({ error: result.reason }, { status });
  }
  return Response.json({ taskId: result.taskId, decided: true }, { status: 201 });
}
