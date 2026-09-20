import { describe, expect, test } from "bun:test";
import { captureSourceAnchor } from "../src/source-anchor.ts";

describe("source anchor capture", () => {
  test("captures normalized selected text with an exact document page anchor", () => {
    expect(captureSourceAnchor({
      documentId: "local:chapter-one.pdf",
      page: 7,
      selectedText: "  Atomic\n\tpublication   preserves history.  ",
      rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
    })).toEqual({
      documentId: "local:chapter-one.pdf",
      page: 7,
      kind: "selection",
      quote: "Atomic publication preserves history.",
      rects: [{ x: 0.1, y: 0.2, width: 0.4, height: 0.03 }],
      accuracy: "exact",
    });
  });

  test("discloses quote-only selection capture as potentially ambiguous", () => {
    expect(captureSourceAnchor({
      documentId: "local:chapter-one.pdf",
      page: 7,
      selectedText: "Repeated term",
    }).accuracy).toBe("quote");
  });

  test("rejects source locations outside the PDF page range", () => {
    expect(() => captureSourceAnchor({
      documentId: "local:chapter-one.pdf",
      page: 0,
    })).toThrow("page must be a positive integer");
  });

  test("rejects non-finite and out-of-page normalized selection rectangles", () => {
    const base = {
      documentId: "local:chapter-one.pdf",
      page: 1,
      selectedText: "Bounded selection",
    };

    for (const rect of [
      { x: Number.NaN, y: 0.2, width: 0.4, height: 0.03 },
      { x: 0.1, y: Number.POSITIVE_INFINITY, width: 0.4, height: 0.03 },
      { x: -0.1, y: 0.2, width: 0.4, height: 0.03 },
      { x: 0.8, y: 0.2, width: 0.4, height: 0.03 },
      { x: 0.1, y: 0.99, width: 0.4, height: 0.03 },
      { x: 0.1, y: 0.2, width: 0, height: 0.03 },
    ]) {
      expect(() => captureSourceAnchor({ ...base, rects: [rect] })).toThrow(
        "selection rectangles must be finite normalized page coordinates",
      );
    }
  });

  test("rejects invalid rectangles even when no selected quote is present", () => {
    expect(() => captureSourceAnchor({
      documentId: "local:chapter-one.pdf",
      page: 1,
      rects: [{ x: Number.NaN, y: 0, width: 1, height: 1 }],
    })).toThrow("selection rectangles must be finite normalized page coordinates");
  });
});
