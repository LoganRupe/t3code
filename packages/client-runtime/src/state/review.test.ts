import { describe, expect, it } from "vite-plus/test";

import { resolveReviewRepository } from "./review.ts";

const api = { relativePath: "api", name: "api", path: "/work/api" };
const root = { relativePath: ".", name: "work", path: "/work" };
const outside = { relativePath: "../shared", name: "shared", path: "/shared" };

describe("resolveReviewRepository", () => {
  it("has none for an ordinary checkout", () => {
    expect(resolveReviewRepository([], "api")).toBeNull();
  });

  it("keeps the picked repository while the workspace still lists it", () => {
    expect(resolveReviewRepository([root, api, outside], "../shared")).toBe(outside);
  });

  it("defaults to the folder's own repository, wherever the workspace file lists it", () => {
    expect(resolveReviewRepository([api, root], null)).toBe(root);
    expect(resolveReviewRepository([api, root], "gone")).toBe(root);
  });

  it("falls back to the first repository when the folder is not one", () => {
    expect(resolveReviewRepository([api, outside], undefined)).toBe(api);
  });
});
