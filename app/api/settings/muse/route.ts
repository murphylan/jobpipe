import { dataRoot } from "../../../../lib/data-root.ts";
import { readMuseEnvironment, probeMuse } from "../../../../lib/muse-environment.ts";
import { museSettingsInputSchema, readMuseSettings } from "../../../../lib/engine/muse-settings.ts";
import { publishEvent } from "../../../../lib/agent/publish.ts";
import { checkConsoleOrigin, getConsoleToken, validConsoleToken } from "../../../../lib/console-protection.ts";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const origin = checkConsoleOrigin(req);
  if (!origin.ok) return Response.json({ error: origin.reason }, { status: 403 });
  try { return Response.json(readMuseEnvironment(dataRoot()), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Muse 配置损坏；保留原文件，请检查后恢复" }, { status: 503 }); }
}
export async function POST(req: Request) {
  const origin = checkConsoleOrigin(req);
  if (!origin.ok) return Response.json({ error: origin.reason }, { status: 403 });
  const base = dataRoot();
  try { if (!validConsoleToken(req.headers.get("x-console-token"), getConsoleToken(base))) return Response.json({ error: "forbidden-token" }, { status: 403 }); }
  catch { return Response.json({ error: "console-token-unavailable" }, { status: 503 }); }
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid-json" }, { status: 400 }); }
  try {
    if (body?.action === "check") return Response.json(await probeMuse(base, readMuseSettings(base)), { headers: { "Cache-Control": "no-store" } });
    const parsed = museSettingsInputSchema.safeParse(body);
    if (!parsed.success || parsed.data.projectRoot !== base) return Response.json({ error: "请输入当前项目路径和 Muse 的绝对路径" }, { status: 400 });
    // Refuse overwriting corrupt configuration and stale forms before queuing.
    if (readMuseSettings(base).version !== parsed.data.expectedVersion) return Response.json({ error: "配置已变化，请刷新后重试" }, { status: 409 });
    const event = publishEvent(base, { event: "MUSE_SETTINGS_CHANGED", payload: parsed.data });
    return Response.json({ queued: true, taskId: event.taskId }, { status: 202 });
  } catch { return Response.json({ error: "配置读取或检查失败；未覆盖原文件" }, { status: 503 }); }
}
