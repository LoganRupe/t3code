import type { ProjectFileRoot } from "@t3tools/client-runtime/project-file-roots";
import type { ProjectEntry } from "@t3tools/contracts";
import { normalizeSearchQuery, scoreQueryMatch } from "@t3tools/shared/searchRanking";

export interface FileTreeNode {
  readonly path: string;
  readonly name: string;
  readonly kind: ProjectEntry["kind"];
  readonly ignored?: boolean;
  readonly children: ReadonlyArray<FileTreeNode>;
  readonly searchSegments: ReadonlyArray<string>;
  readonly searchWords: ReadonlyArray<string>;
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

function splitSearchWords(value: string): ReadonlyArray<string> {
  return value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());
}

function buildNodeSearchTerms(path: string): {
  readonly segments: ReadonlyArray<string>;
  readonly words: ReadonlyArray<string>;
} {
  const segments: string[] = [];
  const words: string[] = [];

  for (const segment of path.split("/")) {
    if (!segment) {
      continue;
    }
    segments.push(segment.toLowerCase());
    words.push(...splitSearchWords(segment));
  }

  return { segments, words };
}

function freezeNode(node: MutableFileTreeNode): FileTreeNode {
  const searchTerms = buildNodeSearchTerms(node.path);
  return {
    path: node.path,
    name: node.name,
    kind: node.kind,
    ...(node.ignored ? { ignored: true } : {}),
    children: [...node.children.values()].sort(compareNodes).map(freezeNode),
    searchSegments: searchTerms.segments,
    searchWords: searchTerms.words,
  };
}

function compareNodes(
  left: Pick<FileTreeNode, "kind" | "name">,
  right: Pick<FileTreeNode, "kind" | "name">,
): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
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

const trimTrailingSeparators = (path: string) => path.replace(/[\\/]+$/, "");

/**
 * A multi-root tree nests each root's files under its label. Returns the root
 * a tree path sits in and the path inside that root, empty for the root's own
 * node. Null for a path under no root, such as an ancestor of a nested label.
 */
export function resolveRootedTreePath(
  roots: ReadonlyArray<ProjectFileRoot>,
  treePath: string,
): (ProjectFileRoot & { readonly relativePath: string }) | null {
  // The longest label wins, so a label containing "/" beats a shorter one it extends.
  let owner: ProjectFileRoot | null = null;
  for (const candidate of roots) {
    const { label } = candidate;
    if (treePath !== label && !treePath.startsWith(`${label}/`)) continue;
    if (owner === null || label.length > owner.label.length) owner = candidate;
  }
  return owner ? { ...owner, relativePath: treePath.slice(owner.label.length + 1) } : null;
}

/**
 * Tree path a multi-root tree lists an absolute file path under, or null when
 * no root holds it. A root nested in another claims its own files.
 */
export function rootedTreePath(
  roots: ReadonlyArray<ProjectFileRoot>,
  absolutePath: string,
): string | null {
  const normalized = absolutePath.replaceAll("\\", "/");
  let match: { readonly prefix: string; readonly label: string } | null = null;
  for (const { root, label } of roots) {
    const prefix = `${trimTrailingSeparators(root).replaceAll("\\", "/")}/`;
    if (!normalized.startsWith(prefix)) continue;
    if (match === null || prefix.length > match.prefix.length) match = { prefix, label };
  }
  return match ? `${match.label}/${normalized.slice(match.prefix.length)}` : null;
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

function valueMatchesSearchToken(value: string, token: string, fuzzy: boolean): boolean {
  return (
    scoreQueryMatch({
      value,
      query: token,
      exactBase: 0,
      prefixBase: 2,
      boundaryBase: 4,
      includesBase: 6,
      ...(fuzzy ? { fuzzyBase: 100 } : {}),
      boundaryMarkers: ["/", "-", "_", "."],
    }) !== null
  );
}

function nodeMatchesSearch(node: FileTreeNode, tokens: ReadonlyArray<string>): boolean {
  return tokens.every(
    (token) =>
      node.searchSegments.some((segment) => valueMatchesSearchToken(segment, token, false)) ||
      node.searchWords.some((word) => valueMatchesSearchToken(word, token, true)),
  );
}

function flattenNode(
  output: VisibleFileTreeNode[],
  node: FileTreeNode,
  depth: number,
  expanded: ReadonlySet<string>,
  searchTokens: ReadonlyArray<string>,
): boolean {
  const isSearching = searchTokens.length > 0;
  const matches = isSearching && nodeMatchesSearch(node, searchTokens);
  let descendantMatches = false;
  const childOutput: VisibleFileTreeNode[] = [];

  if (node.kind === "directory" && (expanded.has(node.path) || isSearching)) {
    for (const child of node.children) {
      if (flattenNode(childOutput, child, depth + 1, expanded, searchTokens)) {
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
  readonly searchQuery?: string;
}): ReadonlyArray<VisibleFileTreeNode> {
  const output: VisibleFileTreeNode[] = [];
  const normalizedSearch = normalizeSearchQuery(input.searchQuery ?? "");
  const searchTokens = normalizedSearch.split(/[\s/\\._-]+/).filter(Boolean);
  for (const node of input.nodes) {
    flattenNode(output, node, 0, input.expanded, searchTokens);
  }
  return output;
}
