import { resolveProjectFileRoots } from "@t3tools/client-runtime/project-file-roots";
import { describe, expect, it } from "vite-plus/test";

import { resolveMarkdownFileLinkMeta } from "../markdown-links";

const folder = (absolutePath: string, exists = true) => ({ absolutePath, exists });
const paths = (roots: ReturnType<typeof resolveProjectFileRoots>) =>
  roots?.map((entry) => entry.root) ?? null;

describe("resolveProjectFileRoots", () => {
  // Chat file links are matched against these roots, so a link has to land on
  // the root the panel lists the file under or the tree cannot highlight it.
  it("claims chat links for nested, outside and worktree roots", () => {
    const roots = paths(
      resolveProjectFileRoots({
        workspaceFolders: [folder("/ws/api"), folder("/ws/notes/2026"), folder("/elsewhere/notes")],
        repoRoots: ["/ws/api"],
        worktrees: [{ repoRoot: "/ws/api", worktreePath: "/wt/feature/api" }],
      }),
    );
    const link = (path: string) =>
      resolveMarkdownFileLinkMeta(path, "/ws", undefined, roots ?? undefined);
    expect(link("/ws/notes/2026/plan.md")).toMatchObject({
      fileRoot: "/ws/notes/2026",
      workspaceRelativePath: "plan.md",
    });
    expect(link("/elsewhere/notes/todo.md")).toMatchObject({
      fileRoot: "/elsewhere/notes",
      workspaceRelativePath: "todo.md",
    });
    expect(link("/wt/feature/api/src/main.ts")).toMatchObject({
      fileRoot: "/wt/feature/api",
      workspaceRelativePath: "src/main.ts",
    });
  });
});
