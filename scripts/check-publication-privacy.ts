import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { publicationFindings } from "../lib/publication-privacy.ts";

const history = process.argv.includes("--history");
const findings: { file: string; rule: string; object?: string }[] = [];
let checked = 0;
if (history) {
  // Scan locally reachable blobs, not GitHub's hidden PR refs or cached objects.
  const lines = execFileSync("git", ["rev-list", "--objects", "--all"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim().split("\n");
  const entries = lines.flatMap(line => {
    const space = line.indexOf(" ");
    return space < 0 ? [] : [{ object: line.slice(0, space), file: line.slice(space + 1) }];
  });
  const objects = [...new Set(entries.map(entry => entry.object))];
  const output = execFileSync("git", ["cat-file", "--batch"], { input: objects.join("\n") + "\n", maxBuffer: 128 * 1024 * 1024 });
  const blobs = new Map<string, string>();
  let offset = 0;
  for (const object of objects) {
    const end = output.indexOf(10, offset);
    const [, type, size] = output.subarray(offset, end).toString().split(" ");
    const length = Number(size);
    if (!Number.isFinite(length)) throw new Error("Cannot read Git object metadata");
    if (type === "blob") blobs.set(object, output.subarray(end + 1, end + 1 + length).toString("utf8"));
    offset = end + 1 + length + 1;
  }
  for (const entry of entries) {
    const text = blobs.get(entry.object);
    if (text === undefined) continue;
    checked++;
    findings.push(...publicationFindings(entry.file, text).map(finding => ({ ...finding, object: entry.object.slice(0, 12) })));
  }
} else {
  // Include untracked, non-ignored files so newly added private material cannot evade the pre-commit check.
  const files = [...new Set(execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean))];
  for (const file of files) {
    let stat;
    try { stat = lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    checked++;
    if (stat.isSymbolicLink()) findings.push({ file, rule: "symbolic-link" });
    else if (stat.isFile()) findings.push(...publicationFindings(file, readFileSync(file, "utf8")));
    else findings.push({ file, rule: "unsupported-entry" });
  }
}
if (findings.length) {
  for (const item of findings) console.error(`${item.object ? `${item.object}:` : ""}${item.file}: ${item.rule}`);
  process.exitCode = 1;
} else console.log(`Privacy checks passed for ${checked} ${history ? "locally reachable historical file objects" : "tracked and non-ignored new files"}. Matched values are never printed.`);
