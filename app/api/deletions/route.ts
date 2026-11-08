import { isObject } from "../../../lib/engine/envelope.ts";
import { dataRoot } from "../../../lib/data-root.ts";
import { writeDeletion } from "../../../lib/engine/console";

export const dynamic = "force-dynamic";

/**
 * The console's deletion write: a decision file in
 * data/inbox/decisions/. Body: { scope, id } where scope
 * is activity or waiting. The engine applies it on its
 * next poll; this endpoint never touches a business data
 * file and never claims the change is applied.
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
  const input = body as { scope?: unknown; id?: unknown };
  const result = writeDeletion(baseDir, { scope: input.scope, id: input.id });
  if (!result.ok) {
    const status =
      result.reason === "activity-not-found" || result.reason === "waiting-not-found"
        ? 404
        : result.reason === "not-completed" || result.reason === "not-closed" || result.reason === "already-deleted"
          ? 409
          : 400;
    return Response.json({ error: result.reason }, { status });
  }
  return Response.json({ scope: result.scope, id: result.id, decided: true }, { status: 201 });
}
