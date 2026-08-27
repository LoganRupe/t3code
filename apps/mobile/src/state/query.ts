import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useMemo } from "react";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

const EMPTY_ASYNC_RESULT_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("mobile-environment-query:empty"),
);

export interface EnvironmentQueryView<A> {
  readonly data: A | null;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

function formatError(cause: Cause.Cause<unknown>): string {
  const error = Cause.squash(cause);
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The environment request failed.";
}

export function useEnvironmentQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): EnvironmentQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ASYNC_RESULT_ATOM;
  const result = useAtomValue(selectedAtom);
  const refresh = useAtomRefresh(selectedAtom);
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: result._tag === "Failure" ? formatError(result.cause) : null,
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

export interface EnvironmentQueriesView<A> {
  /** Lines up with the input atoms; null until that query has a value. */
  readonly results: ReadonlyArray<A | null>;
  readonly error: string | null;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

/**
 * Reads a variable number of query atoms as one subscription, for fan-outs such
 * as one diff preview per repo of a multi-repo thread. `refresh` refetches every
 * query. The caller memoizes `atoms`; a new array is a new subscription.
 */
export function useEnvironmentQueries<A, E>(
  atoms: ReadonlyArray<Atom.Atom<AsyncResult.AsyncResult<A, E>>>,
): EnvironmentQueriesView<A> {
  const combinedAtom = useMemo(
    () =>
      Atom.readable(
        (get) => atoms.map((atom) => get(atom)),
        (refresh) => {
          for (const atom of atoms) {
            refresh(atom);
          }
        },
      ).pipe(Atom.withLabel("mobile-environment-queries")),
    [atoms],
  );
  const results = useAtomValue(combinedAtom);
  const refresh = useAtomRefresh(combinedAtom);
  return useMemo(() => {
    const failure = results.find((result) => result._tag === "Failure");
    return {
      results: results.map((result) => Option.getOrNull(AsyncResult.value(result))),
      error: failure?._tag === "Failure" ? formatError(failure.cause) : null,
      isPending: results.some((result) => result.waiting),
      refresh,
    };
  }, [refresh, results]);
}
