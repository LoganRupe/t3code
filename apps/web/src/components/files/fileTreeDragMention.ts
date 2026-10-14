import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
} from "~/components/chat/composerMentionDrag";

interface FileTreeDragTransfer {
  setData(format: string, data: string): void;
}

export interface FileTreeDragStartEvent {
  readonly dataTransfer: FileTreeDragTransfer | null;
  composedPath(): ReadonlyArray<unknown>;
  preventDefault(): void;
  stopPropagation(): void;
}

export interface FileTreeDragMentionHost {
  /**
   * The path a dragged row is mentioned by, or null when it names no real path; its tree path
   * when omitted.
   */
  mentionPath?(treePath: string): string | null;
}

export interface FileTreeDragMentionController {
  isDragInProgress(): boolean;
  handleSelectionChange(selectedPaths: ReadonlyArray<string>): void;
  handleDragStart(event: FileTreeDragStartEvent): void;
  handleDragEnd(deselect: (treePath: string) => void): void;
}

const itemPathOf = (node: unknown): string | null => {
  if (typeof node !== "object" || node === null) {
    return null;
  }
  const element = node as { getAttribute?: (name: string) => string | null };
  return typeof element.getAttribute === "function" ? element.getAttribute("data-item-path") : null;
};

export function createFileTreeDragMentionController(
  host: FileTreeDragMentionHost,
): FileTreeDragMentionController {
  let selection: ReadonlyArray<string> = [];
  let draggedPaths: ReadonlyArray<string> = [];
  return {
    isDragInProgress: () => draggedPaths.length > 0,
    handleSelectionChange(selectedPaths) {
      selection = selectedPaths;
    },
    handleDragStart(event) {
      if (event.dataTransfer === null) {
        return;
      }
      // Only drags that originate on a tree row are mentions; a text/plain
      // fallback would also tag drags of selected text from the panel chrome.
      let itemPath: string | null = null;
      for (const node of event.composedPath()) {
        itemPath = itemPathOf(node);
        if (itemPath !== null) {
          break;
        }
      }
      if (itemPath === null) {
        return;
      }
      const dragged = selection.includes(itemPath) ? selection : [itemPath];
      const mentions = dragged
        .map((path) => {
          const treePath = path.replace(/\/+$/, "");
          const mentionPath = treePath && host.mentionPath ? host.mentionPath(treePath) : path;
          return mentionPath === null ? null : composerMentionFromTreePath(mentionPath);
        })
        .filter((mention): mention is string => mention !== null);
      if (mentions.length === 0) {
        // Nothing here names a real path, so there is nothing to drag. Cancel before the tree
        // sees the event: it would select the rows and add their tree path as text/plain, which
        // the composer inserts as text.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      draggedPaths = dragged;
      event.dataTransfer.setData(COMPOSER_MENTION_DRAG_TYPE, mentions.join(" "));
    },
    handleDragEnd(deselect) {
      if (draggedPaths.length === 0) {
        return;
      }
      for (const path of draggedPaths) {
        deselect(path);
      }
      draggedPaths = [];
    },
  };
}
