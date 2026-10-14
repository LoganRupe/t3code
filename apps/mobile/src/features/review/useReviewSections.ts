import { resolveFilesystemReadAccess } from "@t3tools/client-runtime/state/filesystem";
import { resolveReviewRepository } from "@t3tools/client-runtime/state/review";
import { environmentSession } from "../../state/session";
import { useCallback, useEffect, useMemo } from "react";
import * as DateTime from "effect/DateTime";

import {
  deriveThreadCheckpointSummaries,
  type ThreadCheckpointSummary,
} from "@t3tools/client-runtime/state/thread-checkpoints";
import type { EnvironmentId, ReviewDiffPreviewSource, ThreadId } from "@t3tools/contracts";

import { useCheckpointDiff } from "../../state/queries";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentPresentation } from "../../state/presentation";
import { reviewEnvironment } from "../../state/review";
import { useWorkspaceRepositories } from "../../state/workspace-repositories";
import { useSelectedThreadProjection } from "../../state/use-thread-detail";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import {
  buildReviewSectionItems,
  getDefaultReviewSectionId,
  getReadyReviewCheckpoints,
  getReviewGitSectionId,
  getReviewSectionIdForCheckpoint,
} from "./reviewModel";
import {
  setReviewAsyncError,
  setReviewGitSections,
  setReviewSelectedRepository,
  setReviewSelectedSectionId,
  setReviewTurnDiff,
  setReviewTurnDiffLoading,
  type ReviewCacheForThread,
} from "./reviewState";

const NO_GIT_SECTIONS: ReadonlyArray<ReviewDiffPreviewSource> = [];

export function useReviewSections(input: {
  readonly enabled?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly reviewCache: ReviewCacheForThread;
}) {
  const { environmentId, reviewCache, threadId } = input;
  const enabled = input.enabled ?? true;
  const fileAccessSession = useEnvironmentQuery(
    environmentId === undefined ? null : environmentSession.sessionStateAtom(environmentId),
  );
  const fileEnvironment = useEnvironmentPresentation(environmentId ?? null);
  const fileAccess = resolveFilesystemReadAccess({
    isCatalogReady: fileEnvironment.isReady,
    connection: fileEnvironment.presentation?.connection ?? null,
    session: fileAccessSession.data,
    sessionError: fileAccessSession.error,
  });
  const { canReadFiles } = fileAccess;
  const selectedThread = useSelectedThreadProjection();
  const { selectedThreadCwd } = useSelectedThreadWorktree();
  // A multi-repo workspace folder lists its repositories; an ordinary checkout lists none.
  // Turn diffs already cover every repository, while Uncommitted and Changes compare one.
  const { repositories, settled: repositoriesSettled } = useWorkspaceRepositories({
    environmentId: enabled ? environmentId : undefined,
    cwd: selectedThreadCwd,
  });
  const repository = resolveReviewRepository(repositories, reviewCache.selectedRepositoryPath);
  const gitDiffCwd = repository?.path ?? selectedThreadCwd;
  const diffPreview = useEnvironmentQuery(
    canReadFiles && enabled && environmentId !== undefined && gitDiffCwd !== null
      ? reviewEnvironment.diffPreview({
          environmentId,
          input: { cwd: gitDiffCwd },
        })
      : null,
  );
  const { loadingTurnIds } = reviewCache.asyncState;

  useEffect(() => {
    if (reviewCache.threadKey && gitDiffCwd !== null && diffPreview.data) {
      setReviewGitSections(reviewCache.threadKey, gitDiffCwd, diffPreview.data.sources);
    }
  }, [diffPreview.data, gitDiffCwd, reviewCache.threadKey]);
  // Another repository's cached sections must not stand in while this one loads.
  const cachedGitSections =
    reviewCache.gitSectionsCwd === gitDiffCwd ? reviewCache.gitSections : NO_GIT_SECTIONS;
  // Until the repository list arrives, the folder's own diff may be the wrong one (or fail).
  const loadingGitSections = fileAccess.isPending || diffPreview.isPending || !repositoriesSettled;

  const readyCheckpoints = useMemo(
    () =>
      getReadyReviewCheckpoints(
        selectedThread === null ? [] : deriveThreadCheckpointSummaries(selectedThread.projection),
      ),
    [selectedThread],
  );
  const checkpointBySectionId = useMemo(
    () =>
      Object.fromEntries(
        readyCheckpoints.map((checkpoint) => [
          getReviewSectionIdForCheckpoint(checkpoint),
          checkpoint,
        ]),
      ) as Record<string, ThreadCheckpointSummary>,
    [readyCheckpoints],
  );
  const reviewSections = useMemo(() => {
    const sections = buildReviewSectionItems({
      checkpoints: readyCheckpoints,
      gitSections:
        canReadFiles || fileAccess.isPending
          ? ((repositoriesSettled ? diffPreview.data?.sources : null) ?? cachedGitSections)
          : [],
      turnDiffById: reviewCache.turnDiffById,
      loadingTurnIds,
      loadingGitSections,
      repository,
    });
    // Keep the selected section while its grant loads, without displaying cached host files.
    return fileAccess.isPending
      ? sections.map((section) =>
          section.kind === "turn" ? section : { ...section, diff: null, isLoading: true },
        )
      : sections;
  }, [
    cachedGitSections,
    canReadFiles,
    diffPreview.data?.sources,
    fileAccess.isPending,
    loadingGitSections,
    loadingTurnIds,
    readyCheckpoints,
    repositoriesSettled,
    repository,
    reviewCache.turnDiffById,
  ]);
  const selectedSection = useMemo(
    () =>
      reviewSections.find((section) => section.id === reviewCache.selectedSectionId) ??
      reviewSections[0] ??
      null,
    [reviewCache.selectedSectionId, reviewSections],
  );
  const fallbackSectionId = useMemo(
    () => getDefaultReviewSectionId(reviewSections),
    [reviewSections],
  );
  const selectedSectionIdExists = useMemo(
    () =>
      reviewCache.selectedSectionId
        ? reviewSections.some((section) => section.id === reviewCache.selectedSectionId)
        : false,
    [reviewCache.selectedSectionId, reviewSections],
  );

  useEffect(() => {
    if (
      reviewSections.length > 0 &&
      reviewCache.threadKey &&
      // A repository's own sections only exist once the list says which one is reviewed.
      repositoriesSettled &&
      (!reviewCache.selectedSectionId || !selectedSectionIdExists)
    ) {
      setReviewSelectedSectionId(reviewCache.threadKey, fallbackSectionId);
    }
  }, [
    fallbackSectionId,
    reviewCache.selectedSectionId,
    repositoriesSettled,
    reviewCache.threadKey,
    reviewSections.length,
    selectedSectionIdExists,
  ]);

  let activeCheckpoint = readyCheckpoints[0] ?? null;
  if (selectedSection?.kind === "turn") {
    activeCheckpoint = checkpointBySectionId[selectedSection.id] ?? activeCheckpoint;
  }
  const activeSectionId = activeCheckpoint
    ? getReviewSectionIdForCheckpoint(activeCheckpoint)
    : null;
  const activeTurnDiff = useCheckpointDiff({
    environmentId: enabled ? (environmentId ?? null) : null,
    threadId: enabled ? (threadId ?? null) : null,
    fromTurnCount:
      enabled && activeCheckpoint ? Math.max(0, activeCheckpoint.checkpointTurnCount - 1) : null,
    toTurnCount: enabled ? (activeCheckpoint?.checkpointTurnCount ?? null) : null,
    ignoreWhitespace: false,
  });

  useEffect(() => {
    if (!reviewCache.threadKey || !activeSectionId) {
      return;
    }
    setReviewTurnDiffLoading(reviewCache.threadKey, activeSectionId, activeTurnDiff.isPending);
  }, [activeSectionId, activeTurnDiff.isPending, reviewCache.threadKey]);

  useEffect(() => {
    if (!reviewCache.threadKey || !activeSectionId || !activeTurnDiff.data) {
      return;
    }
    setReviewTurnDiff(reviewCache.threadKey, activeSectionId, activeTurnDiff.data.diff);
    setReviewAsyncError(reviewCache.threadKey, null);
  }, [activeSectionId, activeTurnDiff.data, reviewCache.threadKey]);

  useEffect(() => {
    if (reviewCache.threadKey && activeTurnDiff.error) {
      setReviewAsyncError(reviewCache.threadKey, activeTurnDiff.error);
    }
  }, [activeTurnDiff.error, reviewCache.threadKey]);

  const refreshSelectedSection = useCallback(async () => {
    if (!enabled) {
      return;
    }
    if (selectedSection?.kind === "turn") {
      activeTurnDiff.refresh();
      return;
    }
    diffPreview.refresh();
  }, [activeTurnDiff, diffPreview, enabled, selectedSection?.kind]);

  // Keeps Uncommitted or Changes selected across the switch; from a turn, opens Changes.
  const selectRepository = useCallback(
    (relativePath: string) => {
      const next = repositories.find((candidate) => candidate.relativePath === relativePath);
      if (!reviewCache.threadKey || !next) {
        return;
      }
      setReviewSelectedRepository(reviewCache.threadKey, relativePath);
      setReviewSelectedSectionId(
        reviewCache.threadKey,
        getReviewGitSectionId(
          selectedSection?.kind === "working-tree" ? "working-tree" : "branch-range",
          next,
        ),
      );
    },
    [repositories, reviewCache.threadKey, selectedSection?.kind],
  );

  const selectSection = useCallback(
    (sectionId: string) => {
      if (reviewCache.threadKey) {
        setReviewSelectedSectionId(reviewCache.threadKey, sectionId);
      }
    },
    [reviewCache.threadKey],
  );

  return {
    error:
      (repositoriesSettled ? diffPreview.error : null) ??
      activeTurnDiff.error ??
      reviewCache.asyncState.error ??
      (selectedSection === null && !fileAccess.isPending && !canReadFiles
        ? (fileAccess.error ?? "This connection cannot read local diffs.")
        : null),
    isSelectedSectionPending:
      selectedSection?.kind === "turn"
        ? activeTurnDiff.isPending
        : diffPreview.isPending || !repositoriesSettled,
    loadingGitDiffs: loadingGitSections,
    gitDiffCwd,
    repositories,
    repository,
    selectRepository,
    diffPreviewRevision: diffPreview.data
      ? DateTime.formatIso(diffPreview.data.generatedAt)
      : undefined,
    loadingTurnIds,
    reviewSections,
    selectedSection,
    refreshSelectedSection,
    selectSection,
  };
}
