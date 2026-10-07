import type { SourceAnchor } from "./source-anchor.ts";

export interface Highlight {
  id: string;
  anchor: SourceAnchor;
  createdAt: string;
}

export interface Comment {
  id: string;
  body: string;
  anchor: SourceAnchor;
  highlightId?: string;
  createdAt: string;
}

export interface AnnotationState {
  highlights: Highlight[];
  comments: Comment[];
}

export function createAnnotationState(): AnnotationState {
  return { highlights: [], comments: [] };
}

export function addHighlight(state: AnnotationState, highlight: Highlight): AnnotationState {
  return { ...state, highlights: [...state.highlights, structuredClone(highlight)] };
}

export function addComment(state: AnnotationState, comment: Comment): AnnotationState {
  return { ...state, comments: [...state.comments, structuredClone(comment)] };
}

export function deleteHighlight(state: AnnotationState, id: string): AnnotationState {
  return { ...state, highlights: state.highlights.filter((highlight) => highlight.id !== id) };
}

export function deleteComment(state: AnnotationState, id: string): AnnotationState {
  return { ...state, comments: state.comments.filter((comment) => comment.id !== id) };
}
