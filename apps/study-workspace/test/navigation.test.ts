import { describe, expect, test } from "bun:test";
import { movePage, moveToAdjacentPage, restoreSourceNavigation } from "../src/navigation.ts";

describe("PDF navigation", () => {
  test("clamps page movement to the loaded document", () => {
    expect(movePage({ current: 1, total: 8 }, -1)).toBe(1);
    expect(movePage({ current: 1, total: 8 }, 1)).toBe(2);
    expect(movePage({ current: 8, total: 8 }, 1)).toBe(8);
  });

  test("distinguishes ordinary page movement from a saved source jump", () => {
    const adjacent = moveToAdjacentPage(
      { current: 1, total: 3 },
      1,
      "pdf:fixture",
    );
    const source = {
      documentId: "pdf:fixture",
      page: 3,
      kind: "selection" as const,
      quote: "A cited sentence.",
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      accuracy: "exact" as const,
    };
    const saved = restoreSourceNavigation(source);

    expect(adjacent).toEqual({
      page: 2,
      anchor: {
        documentId: "pdf:fixture",
        page: 2,
        kind: "page",
        accuracy: "page",
      },
    });
    expect(saved.anchor.kind).toBe("selection");
    expect(saved.anchor.quote).toBe("A cited sentence.");
    expect(saved.anchor).not.toBe(source);
    expect(saved.page).toBe(3);
  });
});
