import {
  fileRootTreePath,
  type ProjectFileRoot,
  type ProjectFileRootTarget,
} from "@t3tools/client-runtime/project-file-roots";
import type { ProjectEntry } from "@t3tools/contracts";

export interface FileTreeNode {
  readonly path: string;
  readonly name: string;
  readonly kind: ProjectEntry["kind"];
  readonly ignored?: boolean;
  readonly children: ReadonlyArray<FileTreeNode>;
}

export interface VisibleFileTreeNode {
  readonly node: FileTreeNode;
  readonly depth: number;
}

interface MutableFileTreeNode {
  path: string;
  name: string;
  kind: ProjectEntry["kind"];
  ignored?: boolean;
  children: Map<string, MutableFileTreeNode>;
}

function createMutableNode(
  path: string,
  name: string,
  kind: ProjectEntry["kind"],
): MutableFileTreeNode {
  return {
    path,
    name,
    kind,
    children: new Map(),
  };
}

function freezeNode(node: MutableFileTreeNode): FileTreeNode {
  return {
    path: node.path,
    name: node.name,
    kind: node.kind,
    ...(node.ignored ? { ignored: true } : {}),
    children: [...node.children.values()].sort(compareNodes).map(freezeNode),
  };
}

const fileNameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareNodes(
  left: Pick<FileTreeNode, "kind" | "name">,
  right: Pick<FileTreeNode, "kind" | "name">,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return fileNameCollator.compare(left.name, right.name);
}

export function buildFileTree(entries: ReadonlyArray<ProjectEntry>): ReadonlyArray<FileTreeNode> {
  const root = createMutableNode("", "", "directory");

  for (const entry of entries) {
    const parts = entry.path.split("/").filter(Boolean);
    if (parts.length === 0) {
      continue;
    }

    let current = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (!part) {
        continue;
      }

      const path = parts.slice(0, index + 1).join("/");
      const isLeaf = index === parts.length - 1;
      const kind = isLeaf ? entry.kind : "directory";
      let child = current.children.get(part);
      if (!child) {
        child = createMutableNode(path, part, kind);
        current.children.set(part, child);
      } else if (isLeaf) {
        child.kind = entry.kind;
      }
      if (isLeaf && entry.ignored) child.ignored = true;
      current = child;
    }
  }

  return [...root.children.values()].sort(compareNodes).map(freezeNode);
}

/**
 * The top level of a tree over several roots: one folder row per root, named by its label.
 * Same-named roots carry parent segments (`team-a/docs`), and `buildFileTree` shows the shared
 * segment as a row of its own.
 */
export function fileRootTreeEntries(roots: ReadonlyArray<ProjectFileRoot>): ProjectEntry[] {
  return roots.map((root) => ({ path: root.label, kind: "directory" }));
}

/**
 * A listing of one directory in a root, as tree rows: only its direct children, named by their
 * tree path so files from different roots never collide.
 */
export function fileRootDirectoryTreeEntries(
  roots: ReadonlyArray<ProjectFileRoot>,
  target: ProjectFileRootTarget,
  entries: ReadonlyArray<ProjectEntry>,
): ProjectEntry[] {
  return entries
    .filter(
      (entry) =>
        entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) === target.relativePath,
    )
    .map((entry) => ({
      ...entry,
      path: fileRootTreePath(roots, { root: target.root, relativePath: entry.path }),
    }));
}

export function defaultExpandedTreePaths(nodes: ReadonlyArray<FileTreeNode>): ReadonlySet<string> {
  const expanded = new Set<string>();
  for (const node of nodes) {
    if (node.kind === "directory") {
      expanded.add(node.path);
    }
  }
  return expanded;
}

function flattenNode(
  output: VisibleFileTreeNode[],
  node: FileTreeNode,
  depth: number,
  expanded: ReadonlySet<string>,
  searchResultPaths: ReadonlySet<string> | null,
): boolean {
  const isSearching = searchResultPaths !== null;
  const matches = searchResultPaths?.has(node.path) ?? false;
  let descendantMatches = false;
  const childOutput: VisibleFileTreeNode[] = [];

  if (node.kind === "directory" && (expanded.has(node.path) || isSearching)) {
    for (const child of node.children) {
      if (flattenNode(childOutput, child, depth + 1, expanded, searchResultPaths)) {
        descendantMatches = true;
      }
    }
  }

  const visible = !isSearching || matches || descendantMatches;
  if (!visible) {
    return false;
  }

  output.push({ node, depth });
  output.push(...childOutput);
  return matches || descendantMatches;
}

export function flattenFileTree(input: {
  readonly nodes: ReadonlyArray<FileTreeNode>;
  readonly expanded: ReadonlySet<string>;
  // Null restores normal directory expansion; an empty set is a search with no results.
  readonly searchResultPaths?: ReadonlySet<string> | null;
}): ReadonlyArray<VisibleFileTreeNode> {
  const output: VisibleFileTreeNode[] = [];
  for (const node of input.nodes) {
    flattenNode(output, node, 0, input.expanded, input.searchResultPaths ?? null);
  }
  return output;
}
