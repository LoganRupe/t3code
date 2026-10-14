import type { ThreadCheckpointSummary } from "@t3tools/client-runtime/state/thread-checkpoints";
import {
  AuthFilesystemReadScope,
  CheckpointRef,
  EnvironmentId,
  MessageId,
  ThreadId,
  RunId,
  type AuthSessionState,
  type ReviewDiffPreviewSource,
  type VcsRepository,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  sessionError: null as string | null,
  sessionAtom: {},
  effects: [] as Array<() => void>,
  checkpoints: [] as ReadonlyArray<ThreadCheckpointSummary>,
  repositories: [] as ReadonlyArray<VcsRepository>,
  previewByCwd: {} as Record<string, ReadonlyArray<ReviewDiffPreviewSource>>,
}));

type QueryAtom =
  | { readonly kind: "repositories" }
  | { readonly kind: "preview"; readonly cwd: string };

vi.mock("@t3tools/client-runtime/state/thread-checkpoints", () => ({
  deriveThreadCheckpointSummaries: () => state.checkpoints,
}));
vi.mock("react", () => ({
  useCallback: <A>(callback: A) => callback,
  useEffect: (effect: () => void) => state.effects.push(effect),
  useMemo: <A>(factory: () => A) => factory(),
}));
vi.mock("../../state/session", () => ({
  environmentSession: { sessionStateAtom: () => state.sessionAtom },
}));
vi.mock("../../state/presentation", () => ({
  useEnvironmentPresentation: () => ({
    isReady: true,
    presentation: { connection: { phase: "connected", error: null } },
  }),
}));
vi.mock("../../state/use-thread-detail", () => ({
  useSelectedThreadProjection: () => ({ projection: {} }),
}));
vi.mock("../../state/use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => ({ selectedThreadCwd: "/repo" }),
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => {
    if (atom === state.sessionAtom) {
      return {
        data: state.session,
        error: state.sessionError,
        isPending: state.session === null,
        refresh: vi.fn(),
      };
    }
    const query = atom as QueryAtom | null;
    if (query?.kind === "repositories") {
      return { data: { repositories: state.repositories }, error: null, isPending: false };
    }
    const sources = query?.kind === "preview" ? state.previewByCwd[query.cwd] : undefined;
    return {
      data: sources ? { sources, generatedAt: DateTime.makeUnsafe(0) } : null,
      error: null,
      isPending: query !== null && sources === undefined,
      refresh: vi.fn(),
    };
  },
}));
vi.mock("../../state/vcs", () => ({
  vcsEnvironment: { listRepositories: () => ({ kind: "repositories" }) },
}));
vi.mock("../../state/queries", () => ({
  useCheckpointDiff: () => ({ data: null, error: null, isPending: false, refresh: vi.fn() }),
}));
vi.mock("../../state/review", () => ({
  reviewEnvironment: {
    diffPreview: (input: { input: { cwd: string } }) => ({
      kind: "preview",
      cwd: input.input.cwd,
    }),
  },
}));
vi.mock("./reviewState", () => ({
  setReviewAsyncError: vi.fn(),
  setReviewGitSections: vi.fn(),
  setReviewSelectedRepository: vi.fn(),
  setReviewSelectedSectionId: vi.fn(),
  setReviewTurnDiff: vi.fn(),
  setReviewTurnDiffLoading: vi.fn(),
}));

import {
  setReviewSelectedRepository,
  setReviewSelectedSectionId,
  type ReviewCacheForThread,
} from "./reviewState";
import { useReviewSections } from "./useReviewSections";

beforeEach(() => {
  vi.clearAllMocks();
  state.effects = [];
  state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
  state.sessionError = null;
  state.repositories = [];
  state.previewByCwd = {};
  state.checkpoints = [
    {
      runId: RunId.make("turn-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/thread/1"),
      status: "ready",
      files: [],
      assistantMessageId: MessageId.make("message-1"),
      completedAt: "2026-04-01T00:00:00.000Z",
    },
  ];
});

const checkpointDiff = "diff --git a/checkpoint.ts b/checkpoint.ts";
const localDiff = "diff --git a/local.ts b/local.ts";
function makeReviewCache(
  kind: "working-tree" | "branch-range" = "working-tree",
): ReviewCacheForThread {
  return {
    threadKey: "environment:thread",
    gitSections: [
      {
        id: kind,
        kind,
        title: "Dirty worktree",
        baseRef: "HEAD",
        headRef: null,
        diff: localDiff,
        diffHash: "cached-local",
        truncated: false,
      },
    ],
    gitSectionsCwd: "/repo",
    selectedRepositoryPath: null,
    turnDiffById: { "turn:1": checkpointDiff },
    selectedSectionId: `git:${kind}`,
    asyncState: { loadingTurnIds: {}, error: null },
    expandedFileIdsBySection: {},
    revealedLargeFileIdsBySection: {},
    viewedFileIdsBySection: {},
  };
}

function makeInput(reviewCache = makeReviewCache()) {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    reviewCache,
  };
}

function renderSections(input: ReturnType<typeof makeInput>) {
  const result = useReviewSections(input);
  const effects = state.effects.splice(0);
  effects.forEach((effect) => effect());
  return result;
}

it("hides cached local diffs after file access is lost while retaining checkpoint diffs", () => {
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);

  expect(setReviewSelectedSectionId).toHaveBeenCalledWith("environment:thread", "turn:1");
});

it.each(["working-tree", "branch-range"] as const)(
  "preserves a cached %s selection while an expired grant reloads",
  (kind) => {
    const input = makeInput(makeReviewCache(kind));
    expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

    state.session = null;
    const pending = renderSections(input);
    expect(pending.selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: null, isLoading: true }),
    );
    expect(pending.loadingGitDiffs).toBe(true);
    expect(pending.reviewSections.find((section) => section.id === "turn:1")?.diff).toBe(
      checkpointDiff,
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

    state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
    expect(renderSections(input).selectedSection).toEqual(
      expect.objectContaining({ id: `git:${kind}`, diff: localDiff, isLoading: false }),
    );
    expect(setReviewSelectedSectionId).not.toHaveBeenCalled();
  },
);

it("falls back to a checkpoint when a pending grant resolves without file access", () => {
  const input = makeInput();
  state.session = null;
  renderSections(input);
  expect(setReviewSelectedSectionId).not.toHaveBeenCalled();

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.reviewSections.map((section) => section.id)).toEqual(["turn:1"]);
  expect(denied.selectedSection?.diff).toBe(checkpointDiff);
  expect(setReviewSelectedSectionId).toHaveBeenCalledWith("environment:thread", "turn:1");
});

it("reports a failed access check when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.sessionError = "The session request timed out.";
  const unavailable = renderSections(input);
  expect(unavailable.selectedSection).toBeNull();
  expect(unavailable.reviewSections).toEqual([]);
  expect(unavailable.error).toBe(state.sessionError);
});

it("reports denied file access when no checkpoint can replace the local review", () => {
  state.checkpoints = [];
  const input = makeInput();
  expect(renderSections(input).selectedSection?.diff).toBe(localDiff);

  state.session = { authenticated: true, scopes: [] };
  const denied = renderSections(input);
  expect(denied.selectedSection).toBeNull();
  expect(denied.reviewSections).toEqual([]);
  expect(denied.loadingGitDiffs).toBe(false);
  expect(denied.error).toBe("This connection cannot read local diffs.");
});

it("keeps a cached checkpoint available when the filesystem access check fails", () => {
  state.sessionError = "The session request timed out.";
  const checkpoint = renderSections(makeInput());
  expect(checkpoint.selectedSection?.diff).toBe(checkpointDiff);
  expect(checkpoint.error).toBeNull();
});

function makeSource(kind: "working-tree" | "branch-range", diff: string): ReviewDiffPreviewSource {
  return {
    id: kind,
    kind,
    title: kind === "working-tree" ? "Uncommitted" : "Changes vs main",
    baseRef: kind === "working-tree" ? "HEAD" : "main",
    headRef: null,
    diff,
    diffHash: diff,
    truncated: false,
  };
}

const apiDiff = "diff --git a/api.ts b/api.ts";
const webDiff = "diff --git a/web.ts b/web.ts";

function useMultiRepoWorkspace() {
  // The thread's folder is not a repository; the workspace file lists two inside it.
  state.repositories = [
    { relativePath: "web", name: "web", path: "/repo/web" },
    { relativePath: "api", name: "api", path: "/repo/api" },
  ];
  state.previewByCwd = {
    "/repo/web": [makeSource("working-tree", webDiff)],
    "/repo/api": [makeSource("working-tree", apiDiff)],
  };
}

it("compares the picked repository of a multi-repo workspace, labelled with its name", () => {
  useMultiRepoWorkspace();
  const reviewCache = {
    ...makeReviewCache(),
    gitSections: [],
    gitSectionsCwd: null,
    selectedRepositoryPath: "api",
    selectedSectionId: "git:working-tree:api",
  };

  const result = renderSections(makeInput(reviewCache));

  expect(result.gitDiffCwd).toBe("/repo/api");
  expect(result.repository?.name).toBe("api");
  expect(result.selectedSection).toEqual(
    expect.objectContaining({ title: "Uncommitted · api", diff: apiDiff }),
  );
  expect(result.reviewSections.find((section) => section.id === "turn:1")?.diff).toBe(
    checkpointDiff,
  );
});

it("defaults to the first listed repository when the folder is not one", () => {
  useMultiRepoWorkspace();
  const reviewCache = { ...makeReviewCache(), gitSections: [], gitSectionsCwd: null };

  const result = renderSections(makeInput(reviewCache));

  expect(result.gitDiffCwd).toBe("/repo/web");
  expect(result.reviewSections.map((section) => section.id)).toContain("git:working-tree:web");
});

it("never shows another repository's cached diff while the picked one loads", () => {
  useMultiRepoWorkspace();
  state.previewByCwd = {};
  const reviewCache = {
    ...makeReviewCache(),
    gitSections: [makeSource("working-tree", webDiff)],
    gitSectionsCwd: "/repo/web",
    selectedRepositoryPath: "api",
    selectedSectionId: "git:working-tree:api",
  };

  const result = renderSections(makeInput(reviewCache));

  expect(result.selectedSection).toEqual(
    expect.objectContaining({ id: "git:working-tree:api", diff: null, isLoading: true }),
  );
  expect(setReviewSelectedSectionId).not.toHaveBeenCalled();
});

it("keeps Uncommitted selected when the user picks another repository", () => {
  useMultiRepoWorkspace();
  const reviewCache = {
    ...makeReviewCache(),
    gitSections: [],
    gitSectionsCwd: null,
    selectedSectionId: "git:working-tree:web",
  };

  renderSections(makeInput(reviewCache)).selectRepository("api");

  expect(setReviewSelectedRepository).toHaveBeenCalledWith("environment:thread", "api");
  expect(setReviewSelectedSectionId).toHaveBeenCalledWith(
    "environment:thread",
    "git:working-tree:api",
  );
});

it("reviews an ordinary checkout's own folder without a repository picker", () => {
  state.previewByCwd = { "/repo": [makeSource("working-tree", localDiff)] };

  const result = renderSections(makeInput());

  expect(result.gitDiffCwd).toBe("/repo");
  expect(result.repository).toBeNull();
  expect(result.selectedSection).toEqual(
    expect.objectContaining({ id: "git:working-tree", title: "Uncommitted", diff: localDiff }),
  );
});
