import { readFileSync } from "node:fs";
import path from "node:path";
import { deleteAuthorizedHistory, type HistoryDeletionRequest } from "../lib/engine/history-deletion.ts";
const [requestFile, flag] = process.argv.slice(2);
if (!requestFile || flag !== "--execute") throw new Error("Usage: node scripts/delete-authorized-history.ts <request.json> --execute");
const base = process.cwd();
const full = path.resolve(requestFile);
if (path.dirname(full) !== path.join(base, "data/inbox/maintenance")) throw new Error("Request must be under data/inbox/maintenance");
console.log(JSON.stringify(deleteAuthorizedHistory(base, JSON.parse(readFileSync(full, "utf8")) as HistoryDeletionRequest), null, 2));
