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

export function captureSourceAnchor(input: SourceAnchorInput): SourceAnchor {
  if (!Number.isInteger(input.page) || input.page < 1) {
    throw new Error("page must be a positive integer");
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
