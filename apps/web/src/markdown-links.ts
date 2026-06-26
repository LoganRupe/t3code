import {
  fileBasename,
  formatFilePathPosition,
  inlineCodeFilePathCandidate,
  isRelativeFilePath,
  normalizeMarkdownLinkDestination,
  parseFileUrlHref,
  parseMarkdownFileLink,
  safeDecodeURIComponent,
  splitFilePathPosition,
  workspaceRelativeFilePath,
} from "@t3tools/client-runtime/markdown-links";

import { formatWorkspaceRelativePath } from "./filePathDisplay";
import { isTerminalLinkActivation, resolvePathLinkTarget } from "./terminal-links";

export { normalizeMarkdownLinkDestination };

const MARKDOWN_LINK_HREF_PATTERN =
  /\[[^\]]*]\(\s*(?:<([^>\n]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g;

export interface MarkdownFileLinkMeta {
  filePath: string;
  targetPath: string;
  displayPath: string;
  workspaceRelativePath: string | null;
  // Multi-repo workspaces (#923): the repo root that owns this file, when the
  // absolute path falls under one of the workspace's roots. Lets the preview
  // read `workspaceRelativePath` against the owning repo instead of the anchor.
  fileRoot?: string;
  basename: string;
  line?: number;
  column?: number;
}

export function extractMarkdownLinkHrefs(markdown: string): string[] {
  const hrefs: string[] = [];
  for (const match of markdown.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = (match[1] ?? match[2])?.trim();
    if (href) hrefs.push(href);
  }
  return hrefs;
}

export function shouldOpenMarkdownFileLinkInEditor(
  event: Pick<MouseEvent, "metaKey" | "ctrlKey">,
  platform?: string,
): boolean {
  return isTerminalLinkActivation(event, platform);
}

export function shouldOpenMarkdownFileLinkInBrowserByDefault(path: string): boolean {
  return /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");
}

export function isWindowsDrivePathHref(href: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(safeDecodeURIComponent(href));
}

export function rewriteMarkdownFileUriHref(href: string | undefined): string | null {
  if (!href) return null;
  const target = parseFileUrlHref(normalizeMarkdownLinkDestination(href));
  return target ? `${target.path}${target.hash}` : null;
}

/**
 * `baseDir` anchors relative links; it defaults to the workspace root and is the
 * file's own directory when rendering a markdown file. `cwd` stays the workspace
 * root so the result still knows whether the target is inside it.
 */
export function resolveMarkdownFileLinkTarget(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
): string | null {
  if (!href) return null;
  const target = parseMarkdownFileLink(href);
  if (!target) return null;

  const pathWithPosition = formatFilePathPosition(target);
  if (!isRelativeFilePath(pathWithPosition)) return pathWithPosition;
  if (!baseDir) return null;
  return resolvePathLinkTarget(pathWithPosition, baseDir);
}

/**
 * Inline code spans mostly hold identifiers, commands, and refs (`node.meta`,
 * `origin/main`) rather than deliberate link destinations, so auto-linking
 * them demands stronger path evidence than an explicit markdown link does:
 * an unambiguous path prefix, a file extension, or a :line suffix.
 */
export function resolveInlineCodeFileLinkMeta(
  codeText: string,
  cwd?: string,
  baseDir: string | undefined = cwd,
  repoRoots?: readonly string[],
): MarkdownFileLinkMeta | null {
  const candidate = inlineCodeFilePathCandidate(codeText);
  if (candidate === null) return null;

  return resolveMarkdownFileLinkMeta(candidate, cwd, baseDir, repoRoots);
}

/**
 * Find which repo root (if any) owns an absolute path, returning the root and
 * the path relative to it. The most specific (longest) matching root wins so
 * nested roots resolve correctly. Multi-repo workspaces (#923).
 */
function resolveOwningRoot(
  path: string,
  repoRoots: readonly string[] | undefined,
): { root: string; relativePath: string } | null {
  if (!repoRoots || repoRoots.length === 0) return null;
  let best: { root: string; relativePath: string } | null = null;
  for (const root of repoRoots) {
    const relativePath = workspaceRelativeFilePath(path, root);
    if (relativePath === null) continue;
    if (!best || root.length > best.root.length) {
      best = { root, relativePath };
    }
  }
  return best;
}

export function resolveMarkdownFileLinkMeta(
  href: string | undefined,
  cwd?: string,
  baseDir: string | undefined = cwd,
  repoRoots?: readonly string[],
): MarkdownFileLinkMeta | null {
  const targetPath = resolveMarkdownFileLinkTarget(href, cwd, baseDir);
  if (!targetPath) return null;
  return buildFileLinkMetaFromTarget(targetPath, cwd, repoRoots);
}

function buildFileLinkMetaFromTarget(
  targetPath: string,
  cwd?: string,
  repoRoots?: readonly string[],
): MarkdownFileLinkMeta {
  const { path, line, column } = splitFilePathPosition(targetPath);

  // In a multi-repo workspace the path may live in a non-anchor repo; resolve
  // its owning root so the preview reads it from the right place. Fall back to
  // the anchor `cwd` resolution when no root claims it.
  const owning = resolveOwningRoot(path, repoRoots);

  return {
    filePath: path,
    targetPath,
    displayPath: formatWorkspaceRelativePath(targetPath, cwd),
    workspaceRelativePath: owning?.relativePath ?? workspaceRelativeFilePath(path, cwd),
    ...(owning ? { fileRoot: owning.root } : {}),
    basename: fileBasename(path),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}
