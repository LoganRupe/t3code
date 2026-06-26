import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { T3_PIERRE_ICONS } from "~/pierre-icons";

import { useProjectEntriesQuery } from "./projectFilesQueryState";

interface FileBrowserPanelProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectName: string;
  // Multi-repo workspaces (#923): when set, list the union of these repo roots
  // and group the tree by repo. Omitted/single-entry keeps single-root behavior.
  repoRoots?: readonly string[] | undefined;
  onOpenFile: (relativePath: string, root?: string) => void;
}

interface TreeEntryInfo {
  readonly relativePath: string;
  readonly root?: string;
}

/**
 * Assign each repo root a unique, human-readable label for the tree's top-level
 * grouping. Prefer the folder basename (matching the per-repo git controls);
 * when two roots share a basename, grow the label by parent segments until the
 * labels are distinct.
 */
function buildRootLabels(roots: readonly string[]): Map<string, string> {
  const segments = new Map<string, string[]>();
  for (const root of roots) {
    segments.set(
      root,
      root
        .replaceAll("\\", "/")
        .replace(/\/+$/, "")
        .split("/")
        .filter((segment) => segment.length > 0),
    );
  }

  const labels = new Map<string, string>();
  for (const root of roots) {
    const parts = segments.get(root) ?? [];
    let depth = 1;
    let label = parts.slice(-depth).join("/") || root;
    const collidesAtDepth = () =>
      roots.some(
        (other) => other !== root && (segments.get(other) ?? []).slice(-depth).join("/") === label,
      );
    while (collidesAtDepth() && depth < parts.length) {
      depth += 1;
      label = parts.slice(-depth).join("/");
    }
    labels.set(root, label);
  }
  return labels;
}

const TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
  }
  button[data-type='item'] { border-radius: 5px; }
`;

export default function FileBrowserPanel({
  environmentId,
  cwd,
  projectName,
  repoRoots,
  onOpenFile,
}: FileBrowserPanelProps) {
  const { resolvedTheme } = useTheme();
  const entriesQuery = useProjectEntriesQuery(environmentId, cwd, repoRoots);
  const entries = entriesQuery.data?.entries ?? [];

  // Build the tree paths and a lookup from each path back to its repo-relative
  // path + owning root. In multi-repo mode every entry is prefixed with its
  // repo label so same-named files across repos don't collide and each repo
  // renders as its own top-level node.
  const { treePaths, entryKinds, entryInfo } = useMemo(() => {
    const distinctRoots = [
      ...new Set(
        entries.map((entry) => entry.root).filter((root): root is string => Boolean(root)),
      ),
    ];
    const labels = distinctRoots.length > 0 ? buildRootLabels(distinctRoots) : null;

    const treePaths: string[] = [];
    const entryKinds = new Map<string, ProjectEntry["kind"]>();
    const entryInfo = new Map<string, TreeEntryInfo>();
    for (const entry of entries) {
      const prefix = entry.root && labels ? `${labels.get(entry.root)}/` : "";
      const treeRelativePath = `${prefix}${entry.path}`;
      entryKinds.set(treeRelativePath, entry.kind);
      entryInfo.set(treeRelativePath, {
        relativePath: entry.path,
        ...(entry.root ? { root: entry.root } : {}),
      });
      treePaths.push(entry.kind === "directory" ? `${treeRelativePath}/` : treeRelativePath);
    }
    return { treePaths, entryKinds, entryInfo };
  }, [entries]);

  const entryKindsRef = useRef<ReadonlyMap<string, ProjectEntry["kind"]>>(entryKinds);
  const entryInfoRef = useRef<ReadonlyMap<string, TreeEntryInfo>>(entryInfo);
  const previousTreePathsRef = useRef<readonly string[]>([]);

  const { model } = useFileTree({
    density: "compact",
    fileTreeSearchMode: "hide-non-matches",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    icons: T3_PIERRE_ICONS,
    onSelectionChange: (selectedPaths) => {
      const selectedPath = selectedPaths.at(-1)?.replace(/\/$/, "");
      if (!selectedPath || entryKindsRef.current.get(selectedPath) !== "file") {
        return;
      }
      const info = entryInfoRef.current.get(selectedPath);
      if (info) {
        onOpenFile(info.relativePath, info.root);
      }
    },
    paths: [],
    search: true,
    unsafeCSS: TREE_UNSAFE_CSS,
  });

  useEffect(() => {
    if (previousTreePathsRef.current === treePaths) return;
    entryKindsRef.current = entryKinds;
    entryInfoRef.current = entryInfo;
    previousTreePathsRef.current = treePaths;
    model.resetPaths(treePaths);
  }, [entryInfo, entryKinds, model, treePaths]);

  const fileCount = useMemo(
    () => entries.reduce((count, entry) => count + (entry.kind === "file" ? 1 : 0), 0),
    [entries],
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col bg-background"
      data-file-browser-panel={`${environmentId}:${cwd}`}
    >
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{projectName}</div>
          <div className="truncate text-[10px] leading-none text-muted-foreground">
            {entriesQuery.isPending && entriesQuery.data === null
              ? "Indexing…"
              : `${fileCount.toLocaleString()} files`}
            {entriesQuery.data?.truncated ? " · partial" : ""}
          </div>
        </div>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Search workspace files"
          onClick={() => model.openSearch()}
        >
          <Search className="size-3.5" />
        </button>
        <button
          type="button"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Refresh workspace files"
          onClick={entriesQuery.refresh}
        >
          <RefreshCw className={cn("size-3.5", entriesQuery.isPending && "animate-spin")} />
        </button>
      </div>
      {entriesQuery.error && entriesQuery.data === null ? (
        <div className="p-4 text-xs leading-relaxed text-destructive">{entriesQuery.error}</div>
      ) : (
        <FileTree
          model={model}
          aria-label={`${projectName} files`}
          className="min-h-0 flex-1 overflow-hidden"
          style={{
            colorScheme: resolvedTheme,
            ["--trees-fg-override" as string]: "var(--foreground)",
          }}
        />
      )}
    </div>
  );
}
