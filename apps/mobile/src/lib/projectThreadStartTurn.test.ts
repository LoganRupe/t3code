import { ProjectId, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { serializeComposerMessageForServer } from "./composerContext";

import {
  buildProjectThreadStartTurnInput,
  type ProjectThreadStartTurnSpec,
} from "./projectThreadStartTurn";

describe("project thread title", () => {
  it.each([
    {
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      text: "![photo.png](t3-context://v1/image/photo)",
      title: "Attached image",
    },
    {
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      text: "",
      title: "File: report.pdf",
    },
    {
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      text: "[report.pdf](t3-context://v1/file/report)",
      title: "report.pdf",
    },
  ])("titles a $type-only message without changing its data", ({ text, title, ...attachment }) => {
    const uploadedAttachments = [{ ...attachment, id: "prepared-attachment", sizeBytes: 3 }];
    const wire = serializeComposerMessageForServer(text, undefined, true);
    const spec = {
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "image-thread",
      commandId: "image-command",
      messageId: "image-message",
      createdAt: "2026-09-04T00:00:00Z",
      ...wire,
      titleText: text,
      uploadedAttachments,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access",
      interactionMode: "default",
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "unused",
    } satisfies ProjectThreadStartTurnSpec;
    const input = buildProjectThreadStartTurnInput(spec);

    expect(input.titleSeed).toBe(title);
    expect(input.bootstrap.createThread.title).toBe(input.titleSeed);
    expect(input.message.attachments).toEqual(uploadedAttachments);
    expect(input.message.text).toBe(wire.text);
    const relaunched = buildProjectThreadStartTurnInput({
      ...spec,
      threadId: "local-relaunch",
      text: input.message.text,
      titleText: input.bootstrap.createThread.title,
    });
    expect(relaunched.titleSeed).toBe(title);
    expect(relaunched.message.text).toBe(wire.text);
    expect(relaunched.message.attachments).toEqual(uploadedAttachments);
  });
  it("starts a multi-repo worktree with the picked base of each repository", () => {
    const spec = {
      projectId: ProjectId.make("project"),
      projectCwd: "/workspace",
      threadId: "multi-repo-thread",
      commandId: "multi-repo-command",
      messageId: "multi-repo-message",
      createdAt: "2026-10-14T00:00:00Z",
      text: "Wire the API into the web app",
      uploadedAttachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      workspaceMode: "worktree" as const,
      worktreePath: null,
      startFromOrigin: false,
      worktreeBranchName: "t3code/abc123",
    };
    const input = buildProjectThreadStartTurnInput({
      ...spec,
      branch: "HEAD",
      repositoryBaseRefs: [{ relativePath: "../api", baseRef: "release" }],
    });
    expect(input.bootstrap.prepareWorktree).toEqual({
      projectCwd: "/workspace",
      baseBranch: "HEAD",
      branch: "t3code/abc123",
      repositoryBaseRefs: [{ relativePath: "../api", baseRef: "release" }],
    });

    // Only the picked repositories get a worktree.
    expect(
      buildProjectThreadStartTurnInput({ ...spec, branch: "HEAD", repositories: ["web"] }).bootstrap
        .prepareWorktree,
    ).toEqual({
      projectCwd: "/workspace",
      baseBranch: "HEAD",
      branch: "t3code/abc123",
      repositories: ["web"],
    });

    const withoutPicks = buildProjectThreadStartTurnInput({
      ...spec,
      branch: "main",
      repositoryBaseRefs: [],
    });
    expect(withoutPicks.bootstrap.prepareWorktree).toEqual({
      projectCwd: "/workspace",
      baseBranch: "main",
      branch: "t3code/abc123",
    });
  });
});
