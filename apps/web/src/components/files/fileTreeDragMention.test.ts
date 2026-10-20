import { describe, expect, it } from "@effect/vitest";

import { COMPOSER_MENTION_DRAG_TYPE } from "~/components/chat/composerMentionDrag";
import { createFileTreeDragMentionController } from "./fileTreeDragMention.ts";

const makeTransfer = (plainText = "") => {
  const data = new Map<string, string>([["text/plain", plainText]]);
  return {
    setData: (format: string, value: string) => void data.set(format, value),
    getData: (format: string) => data.get(format) ?? "",
    data,
  };
};

const rowNode = (path: string) => ({
  getAttribute: (name: string) => (name === "data-item-path" ? path : null),
});

describe("createFileTreeDragMentionController with a mention path host", () => {
  it("mentions rows by the path the host names, and cancels drags that name none", () => {
    const controller = createFileTreeDragMentionController({
      mentionPath: (treePath) =>
        treePath === "team-a" ? null : treePath.replace(/^team-a\/docs/, "/work/team-a/docs"),
    });
    const transfer = makeTransfer();
    controller.handleDragStart({
      dataTransfer: transfer,
      preventDefault: () => {},
      stopPropagation: () => {},
      composedPath: () => [rowNode("team-a/docs/guide.md")],
    });
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[guide.md](/work/team-a/docs/guide.md)",
    );
    controller.handleDragEnd(() => {});

    let cancelled = 0;
    controller.handleDragStart({
      dataTransfer: makeTransfer(),
      preventDefault: () => void cancelled++,
      stopPropagation: () => void cancelled++,
      composedPath: () => [rowNode("team-a/")],
    });
    expect(cancelled).toBe(2);
    expect(controller.isDragInProgress()).toBe(false);
  });
});

describe("createFileTreeDragMentionController", () => {
  it("tags a row drag with the mention payload and flags the drag", () => {
    const controller = createFileTreeDragMentionController({});
    const transfer = makeTransfer();
    controller.handleDragStart({
      dataTransfer: transfer,
      preventDefault: () => {},
      stopPropagation: () => {},
      composedPath: () => [{}, rowNode("docs/index.md"), {}],
    });
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe("[index.md](docs/index.md)");
    expect(controller.isDragInProgress()).toBe(true);
  });

  it("does not tag drags of selected text from the panel chrome", () => {
    const controller = createFileTreeDragMentionController({});
    const transfer = makeTransfer("selected text");
    controller.handleDragStart({
      dataTransfer: transfer,
      preventDefault: () => {},
      stopPropagation: () => {},
      composedPath: () => [{}],
    });
    expect(transfer.data.has(COMPOSER_MENTION_DRAG_TYPE)).toBe(false);
    expect(controller.isDragInProgress()).toBe(false);
  });

  it("drags the whole selection when the dragged row is part of it", () => {
    const deselected: Array<string> = [];
    const controller = createFileTreeDragMentionController({});
    const deselect = (path: string) => void deselected.push(path);
    controller.handleSelectionChange(["docs/index.md", "docs/api.md", "src/app.ts"]);
    const transfer = makeTransfer();
    controller.handleDragStart({
      dataTransfer: transfer,
      preventDefault: () => {},
      stopPropagation: () => {},
      composedPath: () => [rowNode("docs/api.md")],
    });
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[index.md](docs/index.md) [api.md](docs/api.md) [app.ts](src/app.ts)",
    );
    controller.handleDragEnd(deselect);
    expect(deselected).toEqual(["docs/index.md", "docs/api.md", "src/app.ts"]);
  });
});
