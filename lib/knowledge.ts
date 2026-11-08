// FR-27: Knowledge base (user-managed, separate from quirks.json).
// - User can add entries (decisions, personal info).
// - User archives (not deletes); archived entries remain queryable.
// - Muse re-reads before applying; re-reads are logged.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export type KnowledgeEntry = {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  archivedAt?: string;
  supersedes?: string;
};

export type KnowledgeFile = {
  version: number;
  updatedAt: string;
  entries: KnowledgeEntry[];
  /** Log of Muse re-reads before applying. */
  rereads: { at: string; taskId?: string; count: number }[];
};

const KNOWLEDGE_FILE = "data/knowledge.json";

function knowledgePath(baseDir: string): string {
  return path.join(baseDir, KNOWLEDGE_FILE);
}

export function readKnowledge(baseDir: string): KnowledgeFile {
  const full = knowledgePath(baseDir);
  if (!existsSync(full)) {
    return { version: 1, updatedAt: new Date().toISOString(), entries: [], rereads: [] };
  }
  const entry = z.object({ id: z.string(), title: z.string(), body: z.string(), tags: z.array(z.string()), createdAt: z.string(), updatedAt: z.string(), archived: z.boolean(), archivedAt: z.string().optional(), supersedes: z.string().optional() }).loose();
  return z.object({ version: z.number(), updatedAt: z.string(), entries: z.array(entry), rereads: z.array(z.object({ at: z.string(), taskId: z.string().optional(), count: z.number() }).loose()) }).loose().parse(JSON.parse(readFileSync(full, "utf-8")));
}

/**
 * Search entries by keyword (title, body, tags). Includes archived.
 */
export function searchKnowledge(baseDir: string, query: string): KnowledgeEntry[] {
  const data = readKnowledge(baseDir);
  const q = query.toLowerCase().trim();
  if (!q) return data.entries;
  return data.entries.filter(
    (e) =>
      e.title.toLowerCase().includes(q) ||
      e.body.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
  );
}
