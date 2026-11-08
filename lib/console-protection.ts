import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { atomicCreateFileSync } from "./engine/storage.ts";

/** Compare exact normalized origin, including protocol/port and bracketed IPv6. */
export function checkConsoleOrigin(req: Request): { ok: true } | { ok: false; reason: string } {
  const host = req.headers.get("host");
  let target: URL;
  try {
    target = new URL(req.url);
    if (!host || /[\s/@?#]/.test(host)) return { ok: false, reason: "forbidden-host" };
    const parsed = new URL(`${target.protocol}//${host}`);
    if (!["http:", "https:"].includes(target.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase()) || parsed.origin !== target.origin) return { ok: false, reason: "forbidden-host" };
  } catch { return { ok: false, reason: "forbidden-host" }; }
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.origin !== target.origin || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return { ok: false, reason: "forbidden-origin" };
    } catch { return { ok: false, reason: "forbidden-origin" }; }
  }
  return { ok: true };
}
export function getConsoleToken(baseDir: string): string {
  if (process.env.CONSOLE_TOKEN) return process.env.CONSOLE_TOKEN;
  const file = path.join(baseDir, "data/.console-token");
  if (!existsSync(file)) atomicCreateFileSync(file, randomBytes(32).toString("hex"));
  const token = readFileSync(file, "utf8").trim();
  if (!token) throw new Error("console token is empty");
  return token;
}
export function validConsoleToken(actual: string | null, expected: string): boolean {
  const a = Buffer.from(actual ?? ""), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
