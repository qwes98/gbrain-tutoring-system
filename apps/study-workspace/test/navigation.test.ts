import { describe, expect, test } from "bun:test";
import { movePage, moveToAdjacentPage, restoreSourceNavigation, sourceLocatorRects } from "../src/navigation.ts";

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
    const saved = restoreSourceNavigation(source, "pdf:fixture", 3);

    expect(adjacent).toEqual({
      page: 2,
      anchor: {
        documentId: "pdf:fixture",
        page: 2,
        kind: "page",
        accuracy: "page",
      },
    });
    expect(saved?.anchor.kind).toBe("selection");
    expect(saved?.anchor.quote).toBe("A cited sentence.");
    expect(saved?.anchor).not.toBe(source);
    expect(saved?.page).toBe(3);
  });

  test("rejects invalid page totals and fractional movement", () => {
    expect(() => movePage({ current: 1, total: 0 }, 1)).toThrow("total pages must be a positive integer");
    expect(() => movePage({ current: 1, total: Number.NaN }, 1)).toThrow("total pages must be a positive integer");
    expect(() => movePage({ current: 1.5, total: 3 }, 1)).toThrow("current page must be an integer within the document");
    expect(() => movePage({ current: 1, total: 3 }, 0.5)).toThrow("page movement must be an integer");
  });

  test("rejects source jumps outside the active document boundary", () => {
    const exact = {
      documentId: "pdf:fixture",
      page: 2,
      kind: "selection" as const,
      quote: "A cited sentence.",
      rects: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      accuracy: "exact" as const,
    };

    expect(restoreSourceNavigation(exact, "pdf:replacement", 3)).toBeNull();
    expect(restoreSourceNavigation({ ...exact, page: Number.NaN }, "pdf:fixture", 3)).toBeNull();
    expect(restoreSourceNavigation({ ...exact, page: 1.5 }, "pdf:fixture", 3)).toBeNull();
    expect(restoreSourceNavigation({ ...exact, page: 4 }, "pdf:fixture", 3)).toBeNull();
    expect(restoreSourceNavigation({ ...exact, rects: [] }, "pdf:fixture", 3)).toBeNull();
    expect(restoreSourceNavigation({
      ...exact,
      rects: [{ x: 0.9, y: 0.2, width: 0.3, height: 0.04 }],
    }, "pdf:fixture", 3)).toBeNull();
    expect(restoreSourceNavigation({
      ...exact,
      rects: [null] as unknown as typeof exact.rects,
    }, "pdf:fixture", 3)).toBeNull();
  });

  test("exposes a visible locator only for an exact source region", () => {
    const rects = [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }];
    expect(sourceLocatorRects({
      documentId: "pdf:fixture",
      page: 2,
      kind: "selection",
      quote: "A cited sentence.",
      rects,
      accuracy: "exact",
    })).toEqual(rects);
    expect(sourceLocatorRects({
      documentId: "pdf:fixture",
      page: 2,
      kind: "selection",
      quote: "A cited sentence.",
      accuracy: "quote",
    })).toEqual([]);
  });

  test("rejects null and clone-hostile source payloads without throwing", () => {
    const cloneHostile = {
      documentId: "pdf:fixture",
      page: 1,
      kind: "page",
      accuracy: "page",
      callback: () => undefined,
    };

    expect(restoreSourceNavigation(null, "pdf:fixture", 1)).toBeNull();
    expect(restoreSourceNavigation(42, "pdf:fixture", 1)).toBeNull();
    expect(restoreSourceNavigation(cloneHostile, "pdf:fixture", 1)).toBeNull();
  });

  test("rejects non-array locator rectangles without throwing", () => {
    expect(sourceLocatorRects({
      documentId: "pdf:fixture",
      page: 1,
      kind: "selection",
      quote: "A cited sentence.",
      rects: "not-an-array",
      accuracy: "exact",
    })).toEqual([]);
  });
});
