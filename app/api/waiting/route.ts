import { isObject } from "../../../lib/engine/envelope.ts";
import { dataRoot } from "../../../lib/data-root.ts";
import { listWaiting, writeWaitingAnswer } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/** Read-only waiting queue, open first. */
export async function GET() {
  const baseDir = dataRoot();
  return Response.json({ waiting: listWaiting(baseDir) }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * The console's waiting-answer write: a decision file in
 * data/inbox/decisions/. Body: { waitingId, action, answer }.
 * The engine applies it on its next poll; this endpoint
 * never touches a business data file and never claims the
 * change is applied.
 */
export async function POST(req: Request) {
  const baseDir = dataRoot();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid-json" }, { status: 400 });
  }
  if (!isObject(body)) return Response.json({ error: "invalid-body" }, { status: 400 });
  const input = body as { waitingId?: unknown; action?: unknown; answer?: unknown; scope?: unknown };
  const result = writeWaitingAnswer(baseDir, { waitingId: input.waitingId, action: input.action, answer: input.answer, scope: input.scope });
  if (!result.ok) {
    const status =
      result.reason === "waiting-not-found"
        ? 404
        : result.reason === "not-open" || result.reason === "already-answered"
          ? 409
          : 400;
    return Response.json({ error: result.reason }, { status });
  }
  return Response.json({ waitingId: result.waitingId, decided: true }, { status: 201 });
}
