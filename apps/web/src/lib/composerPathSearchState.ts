import {
  fileRootFromTreePath,
  fileRootOpenPath,
  type ProjectFileRoot,
} from "@t3tools/client-runtime/project-file-roots";
import {
  type ComposerPathSearchState,
  type ComposerPathSearchTarget,
} from "@t3tools/client-runtime/state/threads";

import { useMemo } from "react";

import { useComposerPathSearch as useComposerPathSearchQuery } from "../state/queries";

/**
 * Path search for the composer's `@` trigger. With `roots`, every folder a `.code-workspace`
 * lists is searched, and a match is mentioned the way a chat link names it: relative to `cwd`
 * inside the project folder, absolute in any other listed folder.
 */
export function useComposerPathSearch(
  target: ComposerPathSearchTarget & { readonly roots?: ReadonlyArray<ProjectFileRoot> },
): ComposerPathSearchState {
  const state = useComposerPathSearchQuery(target);
  const { cwd, roots } = target;
  // A stable list lets the composer menu memo cache between renders.
  const entries = useMemo(
    () =>
      state.entries.map((entry) => {
        const located =
          roots === undefined || cwd === null ? null : fileRootFromTreePath(roots, entry.path);
        return {
          path: located === null ? entry.path : fileRootOpenPath(cwd ?? "", located),
          kind: entry.kind,
        };
      }),
    [cwd, roots, state.entries],
  );
  return {
    entries,
    error: state.error,
    isPending: state.isPending,
  };
}
