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
      "The working directory, /home/me, is the project's workspace folder, not a repository.",
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
});
