import { describe, expect, it } from "vite-plus/test";
import { buildRuntimeInstructions, multiRepoWorkspace } from "./RuntimeInstructions.ts";

describe("buildRuntimeInstructions", () => {
  it("requires explicit registration of every PR and stack layer", () => {
    const instructions = buildRuntimeInstructions({ harness: "Codex" });
    expect(instructions).toContain("When the t3-code MCP server exposes link_pull_request");
    expect(instructions).toContain("with the full PR URL immediately after creating a PR");
    expect(instructions).toContain("For a stack, call it for every layer");
    expect(instructions).toContain("call list_thread_pull_requests and link any PR");
  });

  it("keeps known model and effort metadata on one line", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Codex",
        model: "  custom\nmodel  ",
        reasoningEffort: " high\n",
      }),
    ).toContain("through the Codex harness, as custom model with high reasoning effort.");
  });

  it("names the model by display name and slug when they differ", () => {
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "gpt-5.4", modelName: "GPT-5.4" }),
    ).toContain("through the Codex harness, as GPT-5.4 (model slug: gpt-5.4).");
    expect(
      buildRuntimeInstructions({ harness: "Codex", model: "my-model", modelName: "my-model" }),
    ).toContain("through the Codex harness, as my-model.");
  });

  it.each([undefined, "", "auto", "default"])("omits unresolved model %s", (model) => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", model });
    expect(instructions).toContain("through the Cursor harness.");
    expect(instructions).not.toContain("reasoning effort");
  });

  it("asks for absolute file paths only when the session spans several repos", () => {
    expect(
      buildRuntimeInstructions({ harness: "Codex", multiRepo: { repoRoots: ["/a", "/b"] } }),
    ).toContain("<multi_repo_workspace>");
    expect(buildRuntimeInstructions({ harness: "Codex" })).not.toContain("<multi_repo_workspace>");
  });

  it("names the repos and says a workspace folder anchor is not a repo", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Claude Code",
      multiRepo: { cwd: "/home/me", repoRoots: ["/home/me/api", "/elsewhere/web"] },
    });
    expect(instructions).toContain(
      "This project's repositories are:\n- /home/me/api\n- /elsewhere/web\n",
    );
    expect(instructions).toContain(
      "The working directory, /home/me, is the project's workspace folder, not a repository. Other repositories under it are not part of this project",
    );
  });

  it("does not call the working directory a workspace folder when it is a repo root", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Claude Code",
      multiRepo: { cwd: "/wt/api", repoRoots: ["/wt/api", "/wt/web"] },
    });
    expect(instructions).toContain("- /wt/api\n- /wt/web");
    expect(instructions).not.toContain("workspace folder");
  });
});

describe("multiRepoWorkspace", () => {
  it("is set only when the session has roots beyond its working directory", () => {
    expect(multiRepoWorkspace({ cwd: "/wt/api", repoRoots: ["/wt/api"] })).toBeUndefined();
    expect(
      multiRepoWorkspace({
        cwd: "/home/me",
        additionalRoots: ["/home/me/api"],
        repoRoots: ["/home/me/api"],
      }),
    ).toEqual({ cwd: "/home/me", repoRoots: ["/home/me/api"] });
  });

  it("carries plain folders without counting them as repo roots", () => {
    expect(
      multiRepoWorkspace({
        cwd: "/home/me",
        additionalRoots: ["/home/me/api", "/elsewhere/notes"],
        repoRoots: ["/home/me/api"],
        plainFolders: ["/home/me/docs", "/elsewhere/notes"],
        isolatedRun: true,
      }),
    ).toEqual({
      cwd: "/home/me",
      repoRoots: ["/home/me/api"],
      plainFolders: ["/home/me/docs", "/elsewhere/notes"],
      isolatedRun: true,
    });
  });
});

describe("plain project folders", () => {
  const multiRepo = { cwd: "/home/me", repoRoots: ["/home/me/api", "/elsewhere/web"] };
  const plainFolders = ["/home/me/docs", "/elsewhere/notes"];

  it("lists them apart from the repositories", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Cursor",
      multiRepo: { ...multiRepo, plainFolders },
    });
    expect(instructions).toContain(
      "This project's repositories are:\n- /home/me/api\n- /elsewhere/web\n",
    );
    expect(instructions).toContain(
      "\n</project_repositories>\n\n<project_folders>\nThese folders are also part of this project. They are not git repositories:\n- /home/me/docs\n- /elsewhere/notes\n</project_folders>",
    );
  });

  it("says the folders are shared originals only in an isolated run", () => {
    expect(
      buildRuntimeInstructions({
        harness: "Cursor",
        multiRepo: { ...multiRepo, plainFolders, isolatedRun: true },
      }),
    ).toContain(
      "- /elsewhere/notes\nThese are the original folders, shared with other runs of this project, and T3 Code checkpoints do not cover changes made in them.\n</project_folders>",
    );
    expect(
      buildRuntimeInstructions({ harness: "Cursor", multiRepo: { ...multiRepo, plainFolders } }),
    ).not.toContain("original folders");
  });

  it("leaves the text unchanged when there are none", () => {
    const instructions = buildRuntimeInstructions({ harness: "Cursor", multiRepo });
    expect(
      buildRuntimeInstructions({
        harness: "Cursor",
        multiRepo: { ...multiRepo, plainFolders: [] },
      }),
    ).toBe(instructions);
    expect(instructions).not.toContain("<project_folders>");
    expect(instructions.endsWith("</project_repositories>")).toBe(true);
  });

  it("names them without the multi-repo rules when the session has one repo", () => {
    const instructions = buildRuntimeInstructions({
      harness: "Cursor",
      multiRepo: multiRepoWorkspace({
        cwd: "/home/me/api",
        additionalRoots: ["/elsewhere/notes"],
        plainFolders: ["/home/me/api-docs", "/elsewhere/notes"],
      }),
    });
    expect(instructions).not.toContain("<multi_repo_workspace>");
    expect(instructions).not.toContain("<project_repositories>");
    expect(instructions).toContain("- /home/me/api-docs\n- /elsewhere/notes\n</project_folders>");
  });
});
