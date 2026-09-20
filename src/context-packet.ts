import type { TopicProjection } from "./projection.ts";
import type { SourceAnchor, StudyState } from "./study-state.ts";

export type ContextRole = "source_excerpt" | "learner_comment" | "reading_progress" | "prior_conversation" | "ledger_evidence" | "projection_state";

export interface SourceExcerpt { excerpt_id: string; text: string; anchor: SourceAnchor; }

export interface ContextPacketItem {
  id: string;
  role: ContextRole;
  text: string;
  anchor?: SourceAnchor;
  metadata?: Record<string, unknown>;
}

export interface ContextPacket {
  schema_version: 1;
  question: string;
  limits: { max_items: number; max_text_chars: number };
  item_count: number;
  text_chars: number;
  omitted_count: number;
  truncated_count: number;
  items: ContextPacketItem[];
}

export interface ContextPacketInput {
  question: string;
  source_excerpts: SourceExcerpt[];
  study: StudyState;
  projection: TopicProjection;
  limits: { max_items: number; max_text_chars: number };
}

const ROLE_ORDER: ContextRole[] = [
  "source_excerpt",
  "learner_comment",
  "reading_progress",
  "prior_conversation",
  "ledger_evidence",
  "projection_state",
];

function codePointLength(value: string): number {
  return [...value].length;
}

function truncate(value: string, maximum: number): { text: string; truncated: boolean } {
  const characters = [...value];
  if (characters.length <= maximum) return { text: value, truncated: false };
  if (maximum <= 1) return { text: characters.slice(0, maximum).join(""), truncated: true };
  return { text: `${characters.slice(0, maximum - 1).join("")}…`, truncated: true };
}

function candidates(input: ContextPacketInput): Map<ContextRole, ContextPacketItem[]> {
  const result = new Map<ContextRole, ContextPacketItem[]>(ROLE_ORDER.map((role) => [role, []]));
  result.set("source_excerpt", [...input.source_excerpts]
    .sort((left, right) => left.excerpt_id.localeCompare(right.excerpt_id))
    .map((excerpt) => ({ id: excerpt.excerpt_id, role: "source_excerpt", text: excerpt.text, anchor: excerpt.anchor })));
  result.set("learner_comment", [...input.study.comments]
    .sort((left, right) => left.comment_id.localeCompare(right.comment_id))
    .map((comment) => ({ id: comment.comment_id, role: "learner_comment", text: comment.text, anchor: comment.anchor })));
  result.set("reading_progress", [...input.study.progress]
    .sort((left, right) => left.chapter_id.localeCompare(right.chapter_id))
    .map((progress) => ({
      id: progress.chapter_id,
      role: "reading_progress",
      text: JSON.stringify({ chapter_id: progress.chapter_id, physical_page: progress.physical_page, position: progress.position, completed: progress.completed }),
    })));
  result.set("prior_conversation", [...input.study.conversation]
    .sort((left, right) => left.created_at.localeCompare(right.created_at) || left.turn_id.localeCompare(right.turn_id))
    .map((turn) => ({ id: turn.turn_id, role: "prior_conversation", text: `${turn.speaker}: ${turn.text}`, ...(turn.anchor ? { anchor: turn.anchor } : {}) })));
  result.set("ledger_evidence", input.projection.concepts.map((concept) => ({
    id: concept.concept_id,
    role: "ledger_evidence",
    text: JSON.stringify({ concept_id: concept.concept_id, evidence_event_ids: concept.evidence_event_ids }),
    metadata: { evidence_event_ids: concept.evidence_event_ids },
  })));
  result.set("projection_state", [{
    id: input.projection.topic,
    role: "projection_state",
    text: JSON.stringify({
      topic: input.projection.topic,
      as_of: input.projection.as_of,
      concepts: input.projection.concepts.map((concept) => ({ concept_id: concept.concept_id, status: concept.status })),
      due_reviews: input.projection.review_queue.map((review) => ({ concept_id: review.concept_id, due_at: review.due_at, status: review.status })),
    }),
  }]);
  return result;
}

export function buildContextPacket(input: ContextPacketInput): ContextPacket {
  if (!input.question) throw new Error("context question is required");
  if (!Number.isInteger(input.limits.max_items) || input.limits.max_items < 1) throw new Error("max_items must be a positive integer");
  if (!Number.isInteger(input.limits.max_text_chars) || input.limits.max_text_chars < 1) throw new Error("max_text_chars must be a positive integer");
  const byRole = candidates(input);
  const available = ROLE_ORDER.flatMap((role) => byRole.get(role) ?? []).length;
  const selected: ContextPacketItem[] = [];

  for (let round = 0; selected.length < input.limits.max_items; round += 1) {
    let added = false;
    for (const role of ROLE_ORDER) {
      const item = byRole.get(role)?.[round];
      if (!item || selected.length >= input.limits.max_items) continue;
      selected.push(item);
      added = true;
    }
    if (!added) break;
  }

  let remaining = input.limits.max_text_chars;
  let truncatedCount = 0;
  const bounded = selected.map((item, index) => {
    const remainingItems = selected.length - index;
    const allowance = Math.max(0, Math.floor(remaining / remainingItems));
    const boundedText = truncate(item.text, allowance);
    if (boundedText.truncated) truncatedCount += 1;
    remaining -= codePointLength(boundedText.text);
    return { ...item, text: boundedText.text };
  });
  const textChars = bounded.reduce((total, item) => total + codePointLength(item.text), 0);
  return {
    schema_version: 1,
    question: input.question,
    limits: { ...input.limits },
    item_count: bounded.length,
    text_chars: textChars,
    omitted_count: available - bounded.length,
    truncated_count: truncatedCount,
    items: bounded,
  };
}
