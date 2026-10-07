import { captureSourceAnchor, isNormalizedRect, type NormalizedRect, type SourceAnchor } from "./source-anchor.ts";

export interface PagePosition {
  current: number;
  total: number;
}

export interface SourceNavigation {
  page: number;
  anchor: SourceAnchor;
}

function cloneValidSourceAnchor(source: unknown): SourceAnchor | null {
  let cloned: unknown;
  try {
    cloned = structuredClone(source);
  } catch {
    return null;
  }
  if (typeof cloned !== "object" || cloned === null) return null;

  const candidate = cloned as Record<string, unknown>;
  if (typeof candidate.documentId !== "string" || !Number.isInteger(candidate.page)) return null;
  if (candidate.kind !== "page" && candidate.kind !== "selection") return null;
  if (candidate.accuracy !== "page" && candidate.accuracy !== "quote" && candidate.accuracy !== "exact") return null;
  if (candidate.quote !== undefined && typeof candidate.quote !== "string") return null;
  if (candidate.rects !== undefined
    && (!Array.isArray(candidate.rects) || candidate.rects.some((rect) => !isNormalizedRect(rect)))) return null;
  return candidate as unknown as SourceAnchor;
}

export function sourceLocatorRects(source: unknown): NormalizedRect[] {
  const anchor = cloneValidSourceAnchor(source);
  if (!anchor || anchor.accuracy !== "exact" || !Array.isArray(anchor.rects) || anchor.rects.length === 0) return [];
  return anchor.rects.map((rect) => ({ ...rect }));
}

export function movePage(position: PagePosition, delta: number): number {
  if (!Number.isInteger(position.total) || position.total < 1) {
    throw new Error("total pages must be a positive integer");
  }
  if (!Number.isInteger(position.current) || position.current < 1 || position.current > position.total) {
    throw new Error("current page must be an integer within the document");
  }
  if (!Number.isInteger(delta)) {
    throw new Error("page movement must be an integer");
  }
  return Math.min(position.total, Math.max(1, position.current + delta));
}

export function moveToAdjacentPage(
  position: PagePosition,
  delta: number,
  documentId: string,
): SourceNavigation {
  const page = movePage(position, delta);
  return {
    page,
    anchor: captureSourceAnchor({ documentId, page }),
  };
}

export function restoreSourceNavigation(
  source: unknown,
  activeDocumentId: string,
  totalPages: number,
): SourceNavigation | null {
  if (!Number.isInteger(totalPages) || totalPages < 1) return null;
  const anchor = cloneValidSourceAnchor(source);
  if (!anchor || anchor.documentId !== activeDocumentId) return null;
  if (anchor.page < 1 || anchor.page > totalPages) return null;
  if (anchor.accuracy === "exact" && (!anchor.rects || anchor.rects.length === 0)) return null;
  return {
    page: anchor.page,
    anchor,
  };
}
