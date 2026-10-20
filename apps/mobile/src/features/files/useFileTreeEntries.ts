import {
  fileRootForPath,
  fileRootFromTreePath,
  fileRootOpenPath,
  fileRootTreePath,
  hasSeveralFileRoots,
} from "@t3tools/client-runtime/project-file-roots";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";
import {
  projectFileRootsSearch,
  refreshProjectFileRootsSearch,
  useDebouncedValue,
  useStableFileRoots,
} from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { fileRootDirectoryTreeEntries, fileRootTreeEntries } from "./fileTree";
import type { ProjectFileRootsState } from "./useProjectFileRoots";

/**
 * Entries for the file tree, loaded a directory at a time.
 *
 * Paths are tree paths. With `fileRoots` spanning several folders, the top level is one row per
 * root, named by its label, and every path below carries that label. `openPath` and `treePath`
 * convert between tree paths and the paths file routes take: relative to `cwd` inside the project
 * folder, absolute in any other listed folder.
 */
export function useFileTreeEntries(input: {
  readonly cwd: string | null;
  readonly environmentId: EnvironmentId | null;
  readonly searchQuery: string;
  readonly fileRoots?: ProjectFileRootsState | undefined;
}) {
  const { environmentId } = input;
  // Until the folder list is known the tree holds, so the folder alone never flashes first.
  const cwd = input.fileRoots && !input.fileRoots.ready ? null : input.cwd;
  const refreshRoots = input.fileRoots?.refresh;
  const listedRoots = useStableFileRoots(input.fileRoots?.roots);
  const roots = useMemo(
    () => (cwd === null ? null : (listedRoots ?? [{ label: "", path: cwd }])),
    [cwd, listedRoots],
  );
  const singleRoot = roots !== null && !hasSeveralFileRoots(roots) ? (roots[0] ?? null) : null;
  const searching = input.searchQuery.trim().length > 0;
  const query = input.searchQuery.trim().slice(0, 256);
  const debouncedQuery = useDebouncedValue(query, 200);
  const rootListing =
    singleRoot !== null && environmentId !== null
      ? projectEnvironment.listEntries({
          environmentId,
          input: { cwd: singleRoot.path, directoryPath: "" },
        })
      : null;
  const root = useEnvironmentQuery(rootListing);
  const searchKey =
    searching && debouncedQuery.length > 0 && roots !== null && environmentId !== null
      ? { environmentId, roots, query: debouncedQuery, limit: 200 }
      : null;
  const search = useEnvironmentQuery(searchKey === null ? null : projectFileRootsSearch(searchKey));
  const [, render] = useReducer((value: number) => value + 1, 0);
  const [entriesRevision, entriesChanged] = useReducer((value: number) => value + 1, 0);
  const refreshVersion = useRef(0);
  // The loads below fill this cache in place, so it must outlive renders until the roots change.
  const directories = useMemo(
    () => ({
      roots,
      environmentId,
      entries: new Map<string, ReadonlyArray<ProjectEntry>>(),
      requested: new Set<string>(),
      pending: new Map<string, AbortController>(),
      errors: new Map<string, string>(),
    }),
    [roots, environmentId],
  );
  const [refreshingDirectories, setRefreshingDirectories] = useState<typeof directories | null>(
    null,
  );
  useEffect(
    () => () => {
      refreshVersion.current++;
      for (const controller of directories.pending.values()) controller.abort();
      directories.pending.clear();
    },
    [directories],
  );
  const loadDirectory = (directoryPath: string, refresh = false) => {
    if (
      roots === null ||
      environmentId === null ||
      (!refresh && directories.entries.has(directoryPath)) ||
      directories.pending.has(directoryPath)
    ) {
      return;
    }
    // A row above every root only groups same-named roots; its rows come from the labels.
    const target = fileRootFromTreePath(roots, directoryPath);
    if (target === null) return;
    const controller = new AbortController();
    directories.requested.add(directoryPath);
    directories.pending.set(directoryPath, controller);
    directories.errors.delete(directoryPath);
    render();
    const atom = projectEnvironment.listEntries({
      environmentId,
      input: { cwd: target.root.path, directoryPath: target.relativePath },
    });
    appAtomRegistry.refresh(atom);
    return executeAtomQuery(appAtomRegistry, atom, {
      signal: controller.signal,
      reportFailure: false,
      reportDefect: false,
    }).then((result) => {
      if (controller.signal.aborted) return;
      directories.pending.delete(directoryPath);
      if (result._tag === "Success") {
        directories.entries.set(
          directoryPath,
          fileRootDirectoryTreeEntries(roots, target, result.value.entries),
        );
        entriesChanged();
      } else {
        const error = Cause.squash(result.cause);
        directories.errors.set(
          directoryPath,
          error instanceof Error ? error.message : "Files unavailable",
        );
      }
      render();
    });
  };
  const { refresh: refreshRoot, data: rootData } = root;
  const { data: searchData } = search;
  const snapshot = (() => {
    const merged = new Map<string, ProjectEntry>();
    if (searching) {
      for (const entry of searchData?.entries ?? []) merged.set(entry.path, entry);
    }
    const reachableDirectories = new Set<string>();
    const visit = (items: ReadonlyArray<ProjectEntry>) => {
      for (const entry of items) {
        merged.set(entry.path, entry);
        if (entry.kind === "directory") {
          reachableDirectories.add(entry.path);
          visit(directories.entries.get(entry.path) ?? []);
        }
      }
    };
    visit(
      roots !== null && hasSeveralFileRoots(roots)
        ? fileRootTreeEntries(roots)
        : (rootData?.entries ?? []).filter((entry) => !entry.path.includes("/")),
    );
    return {
      revision: entriesRevision,
      entries: [...merged.values()],
      reachableDirectories,
      searchResultPaths: searching
        ? new Set((searchData?.entries ?? []).map((entry) => entry.path))
        : null,
    };
  })();

  const refresh = () => {
    refreshRoots?.();
    refreshRoot();
    if (searchKey !== null) refreshProjectFileRootsSearch(searchKey);
    const paths = new Set(
      [...directories.requested].filter((path) => snapshot.reachableDirectories.has(path)),
    );
    for (const controller of directories.pending.values()) controller.abort();
    directories.pending.clear();
    directories.errors.clear();
    const version = ++refreshVersion.current;
    setRefreshingDirectories(directories);
    const remaining = paths.values();
    const worker = async () => {
      while (version === refreshVersion.current) {
        const next = remaining.next();
        if (next.done) return;
        await loadDirectory(next.value, true);
      }
    };
    const queries = [
      ...(rootListing === null ? [] : [rootListing]),
      ...(searchKey === null ? [] : [projectFileRootsSearch(searchKey)]),
    ];
    const work = [
      ...queries.map((atom) =>
        executeAtomQuery(appAtomRegistry, atom, { reportFailure: false, reportDefect: false }),
      ),
      ...Array.from({ length: Math.min(4, paths.size) }, () => worker()),
    ];
    render();
    return Promise.all(work).finally(() => {
      if (version === refreshVersion.current) setRefreshingDirectories(null);
    });
  };
  const openPath = (treePath: string) => {
    const target = roots === null ? null : fileRootFromTreePath(roots, treePath);
    return target === null || cwd === null ? treePath : fileRootOpenPath(cwd, target);
  };
  const treePath = (path: string | null) => {
    if (path === null || roots === null || cwd === null) return path;
    const target = fileRootForPath(roots, cwd, path);
    return target === null ? null : fileRootTreePath(roots, target);
  };

  return {
    entries: snapshot.entries,
    searchResultPaths: snapshot.searchResultPaths,
    isRefreshing: refreshingDirectories === directories,
    error:
      root.error ??
      (searching ? search.error : null) ??
      [...directories.errors].find(([path]) => snapshot.reachableDirectories.has(path))?.[1] ??
      null,
    isPending:
      (input.cwd !== null && cwd === null) ||
      root.isPending ||
      directories.pending.size > 0 ||
      (searching && (query !== debouncedQuery || search.isPending)),
    searchTruncated: searching && (search.data?.truncated ?? false),
    loadedDirectories: new Set(directories.entries.keys()),
    loadingDirectories: new Set(directories.pending.keys()),
    loadDirectory,
    refresh,
    openPath,
    treePath,
  };
}
