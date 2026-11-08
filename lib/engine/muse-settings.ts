import { accessSync, constants, existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { commitFiles, type GenericChangeSet, type EventResult } from "./events.ts";
import { atomicWriteFileSync } from "./storage.ts";

export const musePathSchema = z.string().min(1).max(2048).refine(p => path.isAbsolute(p) && !/[\0\r\n]/.test(p), "Use an absolute executable path");
export const museSettingsInputSchema = z.object({ projectRoot: z.string(), museBinary: musePathSchema, expectedVersion: z.number().int().nonnegative() }).strict();
const historySchema = z.object({ version: z.number().int().positive(), museBinary: musePathSchema, taskId: z.string(), updatedAt: z.string() });
export const museSettingsSchema = z.object({ version: z.number().int().nonnegative(), projectRoot: z.string(), museBinary: musePathSchema, updatedAt: z.string(), history: z.array(historySchema) }).strict();
export type MuseSettings = z.infer<typeof museSettingsSchema>;
export function discoverMuseBinary() {
  const dir = path.join(os.homedir(), ".local/bin");
  // Prefer the installed native binary: querying the shell launcher may auto-update it.
  const candidates = existsSync(dir) ? readdirSync(dir).filter(f => /^muse-bin-\d/.test(f)).sort((a,b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  return path.join(dir, candidates[0] ?? "muse");
}
export function readMuseSettings(base: string): MuseSettings {
  const file = path.join(base, "data/muse-settings.json");
  if (!existsSync(file)) return { version: 0, projectRoot: path.resolve(base), museBinary: discoverMuseBinary(), updatedAt: "", history: [] };
  return museSettingsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}
export function executableExists(file: string) { try { accessSync(file, constants.X_OK); return true; } catch { return false; } }
export function applyMuseSettings(base: string, cs: GenericChangeSet): EventResult {
  const parsed = museSettingsInputSchema.safeParse(cs.payload);
  if (!parsed.success) return { ok: false, errors: ["E_SCHEMA: invalid Muse settings"] };
  const p = parsed.data;
  if (p.projectRoot !== path.resolve(base)) return { ok: false, errors: ["E_WORKSPACE: cannot redirect the running JobPipe project"] };
  const result = commitFiles(base, cs.taskId, ["muse-settings.json"], () => {
    const previous = readMuseSettings(base);
    if (previous.version !== p.expectedVersion) throw new Error("E_VERSION: settings changed; reload before saving");
    const next = { version: previous.version + 1, projectRoot: p.projectRoot, museBinary: p.museBinary, updatedAt: cs.createdAt,
      history: [...previous.history, { version: previous.version + 1, museBinary: p.museBinary, taskId: cs.taskId, updatedAt: cs.createdAt }] };
    atomicWriteFileSync(path.join(base, "data/muse-settings.json"), JSON.stringify(museSettingsSchema.parse(next), null, 2) + "\n");
  });
  return result.ok ? { ok: true, summary: "MUSE_SETTINGS_CHANGED: project binding saved" } : result;
}
