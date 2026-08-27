import { describe, expect, it } from "vite-plus/test";

import { resolveDiffPanelIsGitRepo } from "./DiffPanel.logic";

describe("resolveDiffPanelIsGitRepo", () => {
  it("shows diffs for a multi-repo workspace whose anchor is not a repo", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 2, probedIsRepo: false })).toBe(true);
  });

  it("trusts the probe for a single-repo project", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: false })).toBe(false);
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: true })).toBe(true);
  });

  it("assumes a repo while the probe is in flight", () => {
    expect(resolveDiffPanelIsGitRepo({ diffRepoTargetCount: 0, probedIsRepo: undefined })).toBe(
      true,
    );
  });
});
