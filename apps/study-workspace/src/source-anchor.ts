export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SourceAnchor {
  documentId: string;
  page: number;
  kind: "page" | "selection";
  quote?: string;
  rects?: NormalizedRect[];
  accuracy: "page" | "quote" | "exact";
}

export interface SourceAnchorInput {
  documentId: string;
  page: number;
  selectedText?: string;
  rects?: NormalizedRect[];
}

export function isNormalizedRect(rect: unknown): rect is NormalizedRect {
  if (typeof rect !== "object" || rect === null) return false;
  const candidate = rect as Partial<NormalizedRect>;
  const values = [candidate.x, candidate.y, candidate.width, candidate.height];
  return values.every(Number.isFinite)
    && candidate.x! >= 0
    && candidate.y! >= 0
    && candidate.width! > 0
    && candidate.height! > 0
    && candidate.x! + candidate.width! <= 1
    && candidate.y! + candidate.height! <= 1;
}

export function captureSourceAnchor(input: SourceAnchorInput): SourceAnchor {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error("page must be a positive integer");
  }
  if (input.rects?.some((rect) => !isNormalizedRect(rect))) {
    throw new Error("selection rectangles must be finite normalized page coordinates");
  }
  const quote = input.selectedText?.replace(/\s+/g, " ").trim();
  if (quote) {
    const rects = input.rects?.map((rect) => ({ ...rect }));
    return {
      documentId: input.documentId,
      page: input.page,
      kind: "selection",
      quote,
      ...(rects && rects.length > 0 ? { rects } : {}),
      accuracy: rects && rects.length > 0 ? "exact" : "quote",
    };
  }
  return {
    documentId: input.documentId,
    page: input.page,
    kind: "page",
    accuracy: "page",
  };
}
