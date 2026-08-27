import { useCallback, useEffect, useMemo } from "react";

import type { EnvironmentId, OrchestrationCheckpointSummary, ThreadId } from "@t3tools/contracts";
import { resolveDiffRepoTargets } from "@t3tools/client-runtime/state/review";

import { useCheckpointDiff } from "../../state/queries";
import { useEnvironmentQueries } from "../../state/query";
import { reviewEnvironment } from "../../state/review";
import { useSelectedThreadDetail } from "../../state/use-thread-detail";
import { useThreadSelection } from "../../state/use-thread-selection";
import { useSelectedThreadWorktree } from "../../state/use-selected-thread-worktree";
import {
  buildReviewSectionItems,
  getDefaultReviewSectionId,
  getReadyReviewCheckpoints,
  getReviewSectionIdForCheckpoint,
  toReviewTurnDiff,
  type ReviewGitPreview,
} from "./reviewModel";
import {
  setReviewAsyncError,
  setReviewGitPreviews,
  setReviewSelectedSectionId,
  setReviewTurnDiff,
  setReviewTurnDiffLoading,
  type ReviewCacheForThread,
} from "./reviewState";

const EMPTY_WORKTREES: ReadonlyArray<{
  readonly repoRoot: string;
  readonly worktreePath: string;
}> = [];

export function useReviewSections(input: {
  readonly enabled?: boolean;
  readonly environmentId?: EnvironmentId;
  readonly threadId?: ThreadId;
  readonly reviewCache: ReviewCacheForThread;
}) {
  const { environmentId, reviewCache, threadId } = input;
  const enabled = input.enabled ?? true;
  const selectedThread = useSelectedThreadDetail();
  const { selectedThread: selectedThreadShell, selectedThreadProject } = useThreadSelection();
  const { selectedThreadCwd, selectedThreadWorktreePath } = useSelectedThreadWorktree();
  // The shell arrives before the detail and both carry the per-repo worktree
  // map; take whichever has it.
  const threadWorktrees = selectedThread?.worktrees?.length
    ? selectedThread.worktrees
    : (selectedThreadShell?.worktrees ?? EMPTY_WORKTREES);
  const repoRoots = selectedThreadProject?.repoRoots;
  // A multi-repo thread diffs one cwd per repo; anything else diffs the anchor
  // cwd exactly as before.
  const diffRepoTargets = useMemo(
    () =>
      resolveDiffRepoTargets({
        threadWorktrees,
        threadWorktreePath: selectedThreadWorktreePath,
        repoRoots,
      }),
    [repoRoots, selectedThreadWorktreePath, threadWorktrees],
  );
  const diffPreviewTargets = useMemo(
    () =>
      diffRepoTargets.length > 1
        ? diffRepoTargets
        : selectedThreadCwd !== null
          ? [{ repoRoot: null, cwd: selectedThreadCwd }]
          : [],
    [diffRepoTargets, selectedThreadCwd],
  );
  const diffPreviewAtoms = useMemo(
    () =>
      enabled && environmentId !== undefined
        ? diffPreviewTargets.map((target) =>
            reviewEnvironment.diffPreview({ environmentId, input: { cwd: target.cwd } }),
          )
        : [],
    [diffPreviewTargets, enabled, environmentId],
  );
  const diffPreview = useEnvironmentQueries(diffPreviewAtoms);
  const { loadingTurnIds } = reviewCache.asyncState;

  useEffect(() => {
    if (!reviewCache.threadKey) {
      return;
    }
    const previews = diffPreviewTargets.flatMap<ReviewGitPreview>((target, index) => {
      const data = diffPreview.results[index];
      return data ? [{ repoRoot: target.repoRoot, sources: data.sources }] : [];
    });
    // Wait for every repo of a fan-out before publishing, so a section does
    // not flash one repo's files before the rest arrive; a failed repo stops
    // the wait once nothing is pending.
    const complete = previews.length === diffPreviewTargets.length || !diffPreview.isPending;
    if (previews.length > 0 && complete) {
      setReviewGitPreviews(reviewCache.threadKey, previews);
    }
  }, [diffPreview.isPending, diffPreview.results, diffPreviewTargets, reviewCache.threadKey]);

  const readyCheckpoints = useMemo(
    () => getReadyReviewCheckpoints(selectedThread?.checkpoints ?? []),
    [selectedThread?.checkpoints],
  );
  const checkpointBySectionId = useMemo(
    () =>
      Object.fromEntries(
        readyCheckpoints.map((checkpoint) => [
          getReviewSectionIdForCheckpoint(checkpoint),
          checkpoint,
        ]),
      ) as Record<string, OrchestrationCheckpointSummary>,
    [readyCheckpoints],
  );
  const reviewSections = useMemo(
    () =>
      buildReviewSectionItems({
        checkpoints: readyCheckpoints,
        gitPreviews: reviewCache.gitPreviews,
        turnDiffById: reviewCache.turnDiffById,
        loadingTurnIds,
        loadingGitSections: diffPreview.isPending,
      }),
    [
      diffPreview.isPending,
      loadingTurnIds,
      readyCheckpoints,
      reviewCache.gitPreviews,
      reviewCache.turnDiffById,
    ],
  );
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
      (!reviewCache.selectedSectionId || !selectedSectionIdExists)
    ) {
      setReviewSelectedSectionId(reviewCache.threadKey, fallbackSectionId);
    }
  }, [
    fallbackSectionId,
    reviewCache.selectedSectionId,
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
    setReviewTurnDiff(
      reviewCache.threadKey,
      activeSectionId,
      toReviewTurnDiff(activeTurnDiff.data),
    );
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

  const selectSection = useCallback(
    (sectionId: string) => {
      if (reviewCache.threadKey) {
        setReviewSelectedSectionId(reviewCache.threadKey, sectionId);
      }
    },
    [reviewCache.threadKey],
  );

  return {
    error: diffPreview.error ?? activeTurnDiff.error ?? reviewCache.asyncState.error,
    loadingGitDiffs: diffPreview.isPending,
    loadingTurnIds,
    reviewSections,
    selectedSection,
    refreshSelectedSection,
    selectSection,
  };
}
