import type { EnvironmentId, ProjectEntry } from "@t3tools/contracts";
import {
  fileRootFromTreePath,
  fileRootTreePath,
  type ProjectFileRoot,
} from "@t3tools/client-runtime/project-file-roots";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";

/**
 * The rows a tree path groups when it is above every root: the next segment of each root label
 * below it. Same-named roots carry parent segments (`team-a/docs`), so `team-a` is such a row.
 */
function groupedRootEntries(
  roots: ReadonlyArray<ProjectFileRoot>,
  treePath: string,
): ProjectEntry[] {
  const prefix = treePath === "" ? "" : `${treePath}/`;
  const entries = new Map<string, ProjectEntry>();
  for (const root of roots) {
    if (!root.label.startsWith(prefix)) continue;
    const segment = root.label.slice(prefix.length).split("/")[0]!;
    const path = `${prefix}${segment}`;
    if (!entries.has(path)) entries.set(path, { path, kind: "directory" });
  }
  return [...entries.values()];
}

/**
 * Loads only requested directories; collapsing a folder keeps its children cached.
 *
 * Directory keys and entry paths are tree paths. With several roots, the top level is one row per
 * root, named by its label, and `label/sub` loads `sub` from that root. Tree paths are named by
 * the roots, so the caller remounts the hook when the root list changes.
 */
export function useDirectoryEntries(
  environmentId: EnvironmentId,
  roots: ReadonlyArray<ProjectFileRoot>,
  /** False until the roots are known, so the tree is not listed twice. */
  enabled = true,
) {
  const [directories, setDirectories] = useState(new Map<string, readonly ProjectEntry[]>());
  const [errors, setErrors] = useState(new Map<string, string>());
  const [pending, setPending] = useState(0);
  // First loads only: a refresh keeps showing the cached children, so it gets no row spinner.
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(new Set());
  const requests = useRef(new Map<string, Promise<void>>());
  const loaded = useRef(new Set<string>());
  const requested = useRef(new Set<string>());
  const active = useRef(true);
  const running = useRef(0);
  const waiting = useRef<Array<() => void>>([]);

  const load = useCallback(
    function loadDirectory(directoryPath: string, refresh = false): Promise<void> {
      if (!enabled) return Promise.resolve();
      const existing = requests.current.get(directoryPath);
      if (existing)
        return refresh ? existing.then(() => loadDirectory(directoryPath, true)) : existing;
      if (!refresh && loaded.current.has(directoryPath)) return Promise.resolve();
      const target = fileRootFromTreePath(roots, directoryPath);
      if (target === null) {
        // Rows above the roots are synthesized from the labels; nothing is read for them. The
        // update lands asynchronously like a listing, so a load from an effect never sets state
        // during that effect.
        loaded.current.add(directoryPath);
        return Promise.resolve().then(() => {
          if (!active.current) return;
          setDirectories((previous) =>
            new Map(previous).set(directoryPath, groupedRootEntries(roots, directoryPath)),
          );
        });
      }
      loaded.current.add(directoryPath);
      requested.current.add(directoryPath);
      const atom = projectEnvironment.listEntries({
        environmentId,
        input: { cwd: target.root.path, directoryPath: target.relativePath },
      });
      setPending((count) => count + 1);
      if (!refresh) setLoadingDirectories((previous) => new Set(previous).add(directoryPath));
      const request = (async () => {
        if (running.current >= 4)
          await new Promise<void>((resolve) => waiting.current.push(resolve));
        else running.current++;
        try {
          if (!active.current) return undefined;
          return await executeAtomQuery(appAtomRegistry, atom, {
            refresh: true,
            reportFailure: false,
            reportDefect: false,
          });
        } finally {
          const next = waiting.current.shift();
          if (next) next();
          else running.current--;
        }
      })()
        .then((result) => {
          if (!active.current || !result) return;
          if (result._tag === "Success") {
            setDirectories((previous) =>
              new Map(previous).set(
                directoryPath,
                result.value.entries
                  .filter(
                    (entry) =>
                      entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))) ===
                      target.relativePath,
                  )
                  .map((entry) => ({
                    ...entry,
                    path: fileRootTreePath(roots, { root: target.root, relativePath: entry.path }),
                  })),
              ),
            );
            setErrors((previous) => {
              const next = new Map(previous);
              next.delete(directoryPath);
              return next;
            });
          } else {
            loaded.current.delete(directoryPath);
            const cause = Cause.squash(result.cause);
            setErrors((previous) =>
              new Map(previous).set(
                directoryPath,
                cause instanceof Error ? cause.message : "Unable to load folder.",
              ),
            );
          }
        })
        .finally(() => {
          requests.current.delete(directoryPath);
          if (!active.current) return;
          setPending((count) => count - 1);
          if (!refresh)
            setLoadingDirectories((previous) => {
              const next = new Set(previous);
              next.delete(directoryPath);
              return next;
            });
        });
      requests.current.set(directoryPath, request);
      return request;
    },
    [enabled, environmentId, roots],
  );

  useEffect(() => {
    active.current = true;
    void load("");
    return () => {
      active.current = false;
    };
  }, [load]);

  const entries = useMemo(() => {
    const result: ProjectEntry[] = [];
    const visit = (path: string) => {
      for (const entry of directories.get(path) ?? []) {
        result.push(entry);
        if (entry.kind === "directory") visit(entry.path);
      }
    };
    visit("");
    return result;
  }, [directories]);

  const reachableDirectories = useMemo(
    () =>
      new Set([
        "",
        ...entries.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
      ]),
    [entries],
  );

  const refresh = useCallback(() => {
    // Refresh folders already visited, preserving the current expansion state.
    const paths = [...requested.current].filter((path) => reachableDirectories.has(path));
    let next = 0;
    const worker = async () => {
      while (next < paths.length && active.current) {
        const path = paths[next++];
        if (path !== undefined) await load(path, true);
      }
    };
    for (let index = 0; index < Math.min(4, paths.length); index++) void worker();
  }, [load, reachableDirectories]);

  return {
    entries,
    load,
    refresh,
    isPending: pending > 0,
    loadingDirectories,
    ready: directories.has(""),
    error: [...errors].find(([path]) => reachableDirectories.has(path))?.[1] ?? null,
  };
}
