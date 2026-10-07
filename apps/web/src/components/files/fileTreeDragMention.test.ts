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

const dragStart = (path: ReadonlyArray<unknown>, dataTransfer = makeTransfer()) => {
  const calls: Array<string> = [];
  return {
    calls,
    event: {
      dataTransfer,
      composedPath: () => path,
      preventDefault: () => void calls.push("preventDefault"),
      stopPropagation: () => void calls.push("stopPropagation"),
    },
  };
};

const rowNode = (path: string) => ({
  getAttribute: (name: string) => (name === "data-item-path" ? path : null),
});

describe("createFileTreeDragMentionController", () => {
  it("tags a row drag with the mention payload and flags the drag", () => {
    const controller = createFileTreeDragMentionController({ deselect: () => {} });
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([{}, rowNode("docs/index.md"), {}], transfer).event);
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe("[index.md](docs/index.md)");
    expect(controller.isDragInProgress()).toBe(true);
  });

  it("mentions a row by the path the host resolves it to", () => {
    const controller = createFileTreeDragMentionController({
      deselect: () => {},
      mentionPath: (treePath) => `/home/user/dev/${treePath}`,
    });
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([rowNode("notes/ideas.md")], transfer).event);
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[ideas.md](/home/user/dev/notes/ideas.md)",
    );
  });

  it("cancels a drag of rows that name no real path before the tree sees it", () => {
    const deselected: Array<string> = [];
    const controller = createFileTreeDragMentionController({
      deselect: (path) => deselected.push(path),
      mentionPath: (treePath) => (treePath === "dupe-a" ? null : `/dev/${treePath}`),
    });
    const drag = dragStart([rowNode("dupe-a/")]);
    controller.handleDragStart(drag.event);
    expect(drag.calls).toEqual(["preventDefault", "stopPropagation"]);
    expect(drag.event.dataTransfer.data.has(COMPOSER_MENTION_DRAG_TYPE)).toBe(false);
    expect(controller.isDragInProgress()).toBe(false);
    controller.handleDragEnd();
    expect(deselected).toEqual([]);
  });

  it("drags the mentionable part of a selection that includes an unmentionable row", () => {
    const controller = createFileTreeDragMentionController({
      deselect: () => {},
      mentionPath: (treePath) => (treePath === "dupe-a" ? null : `/dev/${treePath}`),
    });
    controller.handleSelectionChange(["dupe-a/", "notes/ideas.md"]);
    const drag = dragStart([rowNode("dupe-a/")]);
    controller.handleDragStart(drag.event);
    expect(drag.calls).toEqual([]);
    expect(drag.event.dataTransfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[ideas.md](/dev/notes/ideas.md)",
    );
  });

  it("strips the trailing slash from directory rows", () => {
    const controller = createFileTreeDragMentionController({ deselect: () => {} });
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([rowNode("docs/architecture/")], transfer).event);
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe("[architecture](docs/architecture)");
  });

  it("does not tag drags of selected text from the panel chrome", () => {
    // Only a drag that originates on a tree row is a mention; dragging a text
    // selection also carries text/plain, and tagging it would drop an invalid
    // pill into the composer.
    const controller = createFileTreeDragMentionController({ deselect: () => {} });
    const transfer = makeTransfer("selected text");
    controller.handleDragStart(dragStart([{}], transfer).event);
    expect(transfer.data.has(COMPOSER_MENTION_DRAG_TYPE)).toBe(false);
    expect(controller.isDragInProgress()).toBe(false);
  });

  it("ignores drags that carry no row path", () => {
    const controller = createFileTreeDragMentionController({ deselect: () => {} });
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([{}], transfer).event);
    expect(transfer.data.has(COMPOSER_MENTION_DRAG_TYPE)).toBe(false);
    expect(controller.isDragInProgress()).toBe(false);
  });

  it("deselects the dragged row exactly once when the drag ends", () => {
    const deselected: Array<string> = [];
    const controller = createFileTreeDragMentionController({
      deselect: (path) => deselected.push(path),
    });
    controller.handleDragStart(dragStart([rowNode("src/app.ts")], makeTransfer()).event);
    controller.handleDragEnd();
    controller.handleDragEnd();
    expect(deselected).toEqual(["src/app.ts"]);
    expect(controller.isDragInProgress()).toBe(false);
  });

  it("drags the whole selection when the dragged row is part of it", () => {
    const deselected: Array<string> = [];
    const controller = createFileTreeDragMentionController({
      deselect: (path) => deselected.push(path),
    });
    controller.handleSelectionChange(["docs/index.md", "docs/api.md", "src/app.ts"]);
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([rowNode("docs/api.md")], transfer).event);
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[index.md](docs/index.md) [api.md](docs/api.md) [app.ts](src/app.ts)",
    );
    controller.handleDragEnd();
    expect(deselected).toEqual(["docs/index.md", "docs/api.md", "src/app.ts"]);
  });

  it("drags only the row under the cursor when it is outside the selection", () => {
    const controller = createFileTreeDragMentionController({ deselect: () => {} });
    controller.handleSelectionChange(["docs/index.md"]);
    const transfer = makeTransfer();
    controller.handleDragStart(dragStart([rowNode("src/app.ts")], transfer).event);
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe("[app.ts](src/app.ts)");
  });

  it("does not deselect anything when no drag was started", () => {
    const deselected: Array<string> = [];
    const controller = createFileTreeDragMentionController({
      deselect: (path) => deselected.push(path),
    });
    controller.handleDragEnd();
    expect(deselected).toEqual([]);
  });
});
