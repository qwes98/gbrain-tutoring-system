import { describe, expect, test } from "bun:test";
import {
  addComment,
  addHighlight,
  createAnnotationState,
  deleteComment,
  deleteHighlight,
} from "../src/annotations.ts";

describe("prototype annotations", () => {
  test("highlights and comments remain independent when either is deleted", () => {
    const anchor = {
      documentId: "local:notes.pdf",
      page: 3,
      kind: "selection" as const,
      quote: "Atomic publication swaps one manifest.",
      accuracy: "exact" as const,
    };
    const withHighlight = addHighlight(createAnnotationState(), {
      id: "highlight-1",
      anchor,
      createdAt: "2026-09-20T00:00:00.000Z",
    });
    const shared = addComment(withHighlight, {
      id: "comment-1",
      body: "Compare this with replacing an owned file.",
      anchor,
      highlightId: "highlight-1",
      createdAt: "2026-09-20T00:01:00.000Z",
    });

    const withoutHighlight = deleteHighlight(shared, "highlight-1");
    expect(withoutHighlight.highlights).toEqual([]);
    expect(withoutHighlight.comments).toEqual(shared.comments);

    const withoutComment = deleteComment(shared, "comment-1");
    expect(withoutComment.comments).toEqual([]);
    expect(withoutComment.highlights).toEqual(shared.highlights);
  });

  test("a page comment does not require a highlight", () => {
    const state = addComment(createAnnotationState(), {
      id: "comment-page",
      body: "Return to this diagram.",
      anchor: {
        documentId: "local:notes.pdf",
        page: 4,
        kind: "page",
        accuracy: "page",
      },
      createdAt: "2026-09-20T00:02:00.000Z",
    });

    expect(state.highlights).toEqual([]);
    expect(state.comments[0]?.highlightId).toBeUndefined();
  });
});
