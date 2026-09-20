import { captureSourceAnchor, type SourceAnchor } from "./source-anchor.ts";

export interface PagePosition {
  current: number;
  total: number;
}

export interface SourceNavigation {
  page: number;
  anchor: SourceAnchor;
}

export function movePage(position: PagePosition, delta: number): number {
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

export function restoreSourceNavigation(source: SourceAnchor): SourceNavigation {
  return {
    page: source.page,
    anchor: structuredClone(source),
  };
}
