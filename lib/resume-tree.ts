import type { ResumeBlock, ResumeFileEntry, ResumeVersionsFile } from "./datafiles";

export type ResumeDependencyNode = {
  id: string;
  label: string;
  kind: "file" | "version" | "block" | "group";
  detail: string;
  jobId?: string;
  selected?: boolean;
  fileName?: string;
  file?: ResumeFileEntry;
  children: ResumeDependencyNode[];
};

/** Only recorded references form edges. Dates and version names are not lineage evidence. */
export function buildResumeDependencies(files: ResumeFileEntry[], versions: ResumeVersionsFile, blocks: ResumeBlock[]): ResumeDependencyNode[] {
  const roots: ResumeDependencyNode[] = files.map(file => ({
    id: `file:${file.name}`, label: file.name, kind: "file", detail: `${(file.sizeBytes / 1024).toFixed(1)} KB`,
    fileName: file.name, file, children: [],
  }));
  const byFile = new Map(roots.map(node => [node.fileName!.toLowerCase(), node]));
  const referencedBlocks = new Set<string>();
  versions.versions.forEach((version, index) => {
    const name = version.file?.split(/[\\/]/).pop();
    const parent = name ? byFile.get(name.toLowerCase()) : undefined;
    if (!parent) {
      blocks.filter(block => block.source === version.version).forEach(block => referencedBlocks.add(block.id));
      return;
    }
    const node: ResumeDependencyNode = {
      id: `version:${index}:${version.version}`, label: version.version, kind: "version", detail: version.note,
      jobId: version.jobId, selected: versions.selected[version.jobId] === version.version,
      children: [],
    };
    for (const block of blocks) {
      if (block.source !== version.version) continue;
      referencedBlocks.add(block.id);
      node.children.push({ id: `${node.id}:block:${block.id}`, label: block.title, kind: "block", detail: block.kind, children: [] });
    }
    parent.children.push(node);
  });
  const unlinked = blocks.filter(block => !referencedBlocks.has(block.id));
  if (unlinked.length) roots.push({
    id: "unlinked-blocks", label: "未关联版本的构件", kind: "group", detail: "来源未匹配现有版本", children: unlinked.map(block => ({
      id: `block:${block.id}`, label: block.title, kind: "block", detail: `来源：${block.source || "未记录"}`, children: [],
    })),
  });
  return roots;
}

export function visibleResumeRows(nodes: ResumeDependencyNode[], collapsed: ReadonlySet<string>, depth = 0): { node: ResumeDependencyNode; depth: number }[] {
  return nodes.flatMap(node => [{ node, depth }, ...(!collapsed.has(node.id) ? visibleResumeRows(node.children, collapsed, depth + 1) : [])]);
}
