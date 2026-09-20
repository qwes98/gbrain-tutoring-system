import { describe, expect, test } from "bun:test";
import { buildContextPacket } from "../src/context-packet.ts";
import { projectEvents } from "../src/projection.ts";
import type { SourceAnchor, StudyState } from "../src/study-state.ts";

describe("deterministic bounded context packets", () => {
  test("labels every context role, preserves anchors, and applies hard deterministic bounds", () => {
    const anchor: SourceAnchor = {
      document_id: "doc",
      document_sha256: "a".repeat(64),
      physical_page: 2,
      display_label: "3",
      kind: "text",
      selected_text: "Append new records.",
      normalized_region: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 },
      status: "exact",
    };
    const study: StudyState = {
      schema_version: 1,
      topic: "pdf",
      active_document: { document_id: "doc", relative_path: "sources/book.pdf", sha256: "a".repeat(64), byte_length: 100, page_count: 5, status: "exact" },
      resume: { chapter_id: "chapter-1", physical_page: 2, position: 0.4 },
      progress: [{ chapter_id: "chapter-1", physical_page: 2, position: 0.4, completed: false, updated_at: "2026-01-01T00:00:00Z" }],
      highlights: [],
      comments: [{ comment_id: "comment-1", text: "I am unsure why replacement is unsafe.", anchor, created_at: "2026-01-01T00:01:00Z" }],
      candidates: [],
      conversation: [{ turn_id: "turn-1", speaker: "learner", text: "What makes this durable?", anchor, created_at: "2026-01-01T00:02:00Z" }],
    };
    const projection = projectEvents([{
      schema_version: 1,
      id: "concept",
      topic: "pdf",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "append", title: "Append-only history", source_refs: ["sources/book.pdf"] },
    }], { asOf: "2026-01-02T00:00:00Z" });
    const input = {
      question: "Why append instead of replace?",
      source_excerpts: [{ excerpt_id: "excerpt-1", text: "Corrections are represented as new records.", anchor }],
      study,
      projection,
      limits: { max_items: 6, max_text_chars: 240 },
    };

    const first = buildContextPacket(input);
    const second = buildContextPacket(structuredClone(input));

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.items.map((item) => item.role)).toEqual([
      "source_excerpt",
      "learner_comment",
      "reading_progress",
      "prior_conversation",
      "ledger_evidence",
      "projection_state",
    ]);
    expect(first.items.filter((item) => item.role === "source_excerpt" || item.role === "learner_comment" || item.role === "prior_conversation")
      .every((item) => item.anchor?.document_sha256 === "a".repeat(64))).toBe(true);
    expect(first.items.reduce((total, item) => total + [...item.text].length, 0)).toBeLessThanOrEqual(240);
    expect(first.item_count).toBeLessThanOrEqual(6);
    expect(first.omitted_count).toBe(0);
  });
});
