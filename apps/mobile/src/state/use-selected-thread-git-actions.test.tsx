import { act, useEffect, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AsyncResult } from "effect/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const harness = vi.hoisted(() => ({
  selection: {
    selectedThread: { environmentId: "environment-1", id: "thread-1" } as unknown,
    selectedThreadProject: { workspaceRoot: "/repo" } as unknown,
    selectedEnvironmentRuntime: { connectionState: "connected" } as unknown,
  },
  worktree: { selectedThreadCwd: "/repo" as string | null, selectedThreadWorktreePath: null },
  repositories: [] as Array<{ relativePath: string; name: string; path: string }>,
  selectedRepositoryPath: null as string | null,
  commandCalls: [] as Array<{ command: string; input: unknown }>,
  refreshStatusCalls: [] as Array<unknown>,
  renderCount: 0,
  onRefreshSettled: () => {},
}));

vi.mock("./use-atom-command", () => ({
  useAtomCommand: (command: unknown) =>
    command === "refreshStatus"
      ? async (input: unknown) => {
          harness.refreshStatusCalls.push(input);
          harness.onRefreshSettled();
          return AsyncResult.success({});
        }
      : async (input: unknown) => {
          harness.commandCalls.push({ command: String(command), input });
          return AsyncResult.success({ refName: "feature" });
        },
}));
vi.mock("./vcs", () => ({
  vcsEnvironment: { refreshStatus: "refreshStatus", switchRef: "switchRef" },
  vcsActionManager: {
    runStackedAction: () => "runStackedAction",
    track: (_registry: unknown, _target: unknown, _options: unknown, run: () => unknown) => run(),
  },
}));
vi.mock("./threads", () => ({ threadEnvironment: { updateMetadata: "updateMetadata" } }));
vi.mock("./queries", () => ({ useBranches: () => ({ data: null, refresh: () => {} }) }));
vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid" }));
vi.mock("./atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("./session", () => ({
  readEnvironmentScope: () => true,
  useEnvironmentScope: () => true,
}));
vi.mock("./use-remote-environment-registry", () => ({ setPendingConnectionError: () => {} }));
vi.mock("./use-vcs-action-state", () => ({ showGitActionResult: () => {} }));
vi.mock("./use-thread-selection", () => ({
  useThreadSelection: () => {
    harness.renderCount += 1;
    if (harness.renderCount > 50) {
      throw new Error("Consumer rerendered more than 50 times");
    }
    return harness.selection;
  },
}));
vi.mock("./use-selected-thread-worktree", () => ({
  useSelectedThreadWorktree: () => harness.worktree,
}));
vi.mock("./workspace-repositories", () => ({
  useWorkspaceRepositories: () => ({ repositories: harness.repositories }),
}));
vi.mock("../features/review/reviewState", () => ({
  useReviewSelectedRepository: () => harness.selectedRepositoryPath,
  setReviewSelectedRepository: () => {},
}));

import { useSelectedThreadGitActions } from "./use-selected-thread-git-actions";

let root: Root | null = null;
let rerender: () => void = () => {};
let actions: ReturnType<typeof useSelectedThreadGitActions> | null = null;

function Consumer() {
  const [, bump] = useReducer((count: number) => count + 1, 0);
  const current = useSelectedThreadGitActions();
  useEffect(() => {
    rerender = bump;
    actions = current;
  });
  return null;
}

async function flush() {
  for (let index = 0; index < 5; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  harness.selection = {
    selectedThread: { environmentId: "environment-1", id: "thread-1" },
    selectedThreadProject: { workspaceRoot: "/repo" },
    selectedEnvironmentRuntime: { connectionState: "connected" },
  };
  harness.worktree = { selectedThreadCwd: "/repo", selectedThreadWorktreePath: null };
  harness.repositories = [];
  harness.selectedRepositoryPath = null;
  harness.commandCalls = [];
  harness.refreshStatusCalls = [];
  harness.renderCount = 0;
  harness.onRefreshSettled = () => rerender();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("useSelectedThreadGitActions", () => {
  it("refreshes once on mount and does not loop when refreshes rerender the consumer", async () => {
    root = createRoot(document.createElement("div"));
    act(() => root!.render(<Consumer />));
    await flush();

    harness.selection = {
      selectedThread: { environmentId: "environment-1", id: "thread-1" },
      selectedThreadProject: { workspaceRoot: "/repo" },
      selectedEnvironmentRuntime: { connectionState: "connected" },
    };
    act(() => rerender());
    await flush();

    expect(harness.refreshStatusCalls).toEqual([
      { environmentId: "environment-1", input: { cwd: "/repo" } },
    ]);
  });
  describe("in a multi-repo workspace", () => {
    beforeEach(() => {
      harness.repositories = [
        { relativePath: ".", name: "workspace", path: "/repo" },
        { relativePath: "web", name: "web", path: "/repo/web" },
      ];
    });

    it("acts on the picked repository and refreshes when the pick changes", async () => {
      root = createRoot(document.createElement("div"));
      act(() => root!.render(<Consumer />));
      await flush();

      harness.selectedRepositoryPath = "web";
      act(() => rerender());
      await flush();

      expect(harness.refreshStatusCalls).toEqual([
        { environmentId: "environment-1", input: { cwd: "/repo" } },
        { environmentId: "environment-1", input: { cwd: "/repo/web" } },
      ]);
    });

    it("leaves the thread's branch alone when switching another repository's branch", async () => {
      harness.selectedRepositoryPath = "web";
      root = createRoot(document.createElement("div"));
      act(() => root!.render(<Consumer />));
      await flush();

      await act(async () => {
        await actions!.onCheckoutSelectedThreadBranch("feature");
      });

      expect(harness.commandCalls).toEqual([
        {
          command: "switchRef",
          input: {
            environmentId: "environment-1",
            input: { cwd: "/repo/web", refName: "feature" },
          },
        },
      ]);
    });

    it("syncs the thread's branch from the workspace folder's own repository", async () => {
      root = createRoot(document.createElement("div"));
      act(() => root!.render(<Consumer />));
      await flush();

      await act(async () => {
        await actions!.onCheckoutSelectedThreadBranch("feature");
      });

      expect(harness.commandCalls.map((call) => call.command)).toEqual([
        "switchRef",
        "updateMetadata",
      ]);
    });
  });
});
