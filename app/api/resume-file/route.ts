import { dataRoot } from "../../../lib/data-root.ts";
import fs from "node:fs";
import path from "node:path";
import { resolveResumeFile } from "../../../lib/resume-files";

export const dynamic = "force-dynamic";

/**
 * Read-only resume PDF serving. Query: ?path=<name>.pdf[&download=1].
 * Whitelist: data/resume-files/ — traversal, subdirs and non-pdf are rejected.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseDir = dataRoot();
  const r = resolveResumeFile(baseDir, url.searchParams.get("path"));
  if (!r.ok) return Response.json({ error: r.reason }, { status: r.reason === "invalid" ? 400 : 404 });
  const download = url.searchParams.get("download") === "1";
  return new Response(fs.readFileSync(r.file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${path.basename(r.file)}"`,
      "Cache-Control": "no-store",
    },
  });
}
