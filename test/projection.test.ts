import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { selectTutorAction } from "../src/policy.ts";
import { projectEvents, writeProjections } from "../src/projection.ts";
import type { TopicProjection } from "../src/projection.ts";
import type { LedgerEvent } from "../src/types.ts";

const event = (id: string, type: LedgerEvent["type"], data: Record<string, unknown>, minute: number): LedgerEvent => ({
  schema_version: 1,
  id,
  topic: "systems",
  type,
  occurred_at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  data,
});

describe("deterministic projections", () => {
  test("orders attempt semantics by exact instant and event id instead of append position", () => {
    const declarations = [
      { ...event("c", "concept.declared", { concept_id: "ordering", title: "Ordering", source_refs: ["sources/book.md#ordering"] }, 0), occurred_at: "2026-01-01T00:00:00Z" },
      { ...event("q1", "question.asked", { question_id: "q1", concept_id: "ordering", prompt: "First", source_refs: ["sources/book.md#ordering"] }, 1), occurred_at: "2026-01-01T00:00:00.1Z" },
      { ...event("q2", "question.asked", { question_id: "q2", concept_id: "ordering", prompt: "Second", source_refs: ["sources/book.md#ordering"] }, 2), occurred_at: "2026-01-01T00:00:00.2Z" },
    ];
    const earlierCorrect = { ...event("a-correct", "attempt.recorded", { question_id: "q1", concept_id: "ordering", answer: "earlier", correct: true, assistance: "none" }, 3), occurred_at: "2026-01-01T00:00:00.3000000001Z" };
    const otherCorrect = { ...event("b-correct", "attempt.recorded", { question_id: "q2", concept_id: "ordering", answer: "other", correct: true, assistance: "none" }, 3), occurred_at: "2026-01-01T00:00:00.3000000002Z" };
    const tiedCorrect = { ...event("m-correct", "attempt.recorded", { question_id: "q1", concept_id: "ordering", answer: "tie first", correct: true, assistance: "none" }, 3), occurred_at: "2026-01-01T00:00:00.3000000003Z" };
    const tiedWrong = { ...event("z-wrong", "attempt.recorded", { question_id: "q1", concept_id: "ordering", answer: "tie last", correct: false, assistance: "none" }, 3), occurred_at: "2026-01-01T00:00:00.3000000003Z" };
    const chronological = [...declarations, earlierCorrect, otherCorrect, tiedCorrect, tiedWrong];
    const reordered = [...declarations, tiedWrong, tiedCorrect, otherCorrect, earlierCorrect];

    const expected = projectEvents(chronological, { asOf: "2026-01-01T00:00:01Z" });
    const actual = projectEvents(reordered, { asOf: "2026-01-01T00:00:01Z" });

    expect(actual).toEqual(expected);
    expect(actual.questions.find((question) => question.question_id === "q1")?.attempts.map((attempt) => attempt.event_id))
      .toEqual(["a-correct", "m-correct", "z-wrong"]);
    expect(actual.concepts[0]?.status).toBe("developing");
    expect(actual.promotion_candidates).toHaveLength(0);
    expect(selectTutorAction(actual)).toMatchObject({ action: "give_hint", evidence_event_ids: ["z-wrong"] });
  });

  test("preserves same-instant causal dependencies before applying event-id ties", () => {
    const occurredAt = "2026-01-01T00:00:00.123456789Z";
    const events: LedgerEvent[] = [
      { schema_version: 1, id: "z-concept", topic: "systems", type: "concept.declared", occurred_at: occurredAt, data: { concept_id: "causal", title: "Causal", source_refs: ["sources/book.md"] } },
      { schema_version: 1, id: "a-question", topic: "systems", type: "question.asked", occurred_at: occurredAt, data: { question_id: "q", concept_id: "causal", prompt: "Why?", source_refs: ["sources/book.md"] } },
      { schema_version: 1, id: "z-attempt", topic: "systems", type: "attempt.recorded", occurred_at: occurredAt, data: { question_id: "q", concept_id: "causal", answer: "wrong", correct: false, assistance: "none" } },
      { schema_version: 1, id: "a-action", topic: "systems", type: "tutor.action", occurred_at: occurredAt, data: { action: "give_hint", concept_id: "causal", question_id: "q", reason_codes: ["minimal_assistance"], evidence_event_ids: ["z-attempt"] } },
    ];

    const state = projectEvents(events, { asOf: "2026-01-01T00:00:01Z" });

    expect(state.questions[0]?.attempts.map((attempt) => attempt.event_id)).toEqual(["z-attempt"]);
    expect(state.tutor_actions.map((action) => action.id)).toEqual(["a-action"]);
  });

  test("uses the earliest exact-instant attempt across questions to complete a review", () => {
    const events: LedgerEvent[] = [
      { schema_version: 1, id: "c", topic: "systems", type: "concept.declared", occurred_at: "2026-01-01T00:00:00Z", data: { concept_id: "review", title: "Review", source_refs: ["sources/book.md"] } },
      { schema_version: 1, id: "q1", topic: "systems", type: "question.asked", occurred_at: "2026-01-01T00:00:00.1Z", data: { question_id: "q1", concept_id: "review", prompt: "One", source_refs: ["sources/book.md"] } },
      { schema_version: 1, id: "q2", topic: "systems", type: "question.asked", occurred_at: "2026-01-01T00:00:00.2Z", data: { question_id: "q2", concept_id: "review", prompt: "Two", source_refs: ["sources/book.md"] } },
      { schema_version: 1, id: "scheduled", topic: "systems", type: "review.scheduled", occurred_at: "2026-01-01T00:00:00.3Z", data: { concept_id: "review", due_at: "2026-01-01T00:00:01Z", reason_event_ids: ["q1"] } },
      { schema_version: 1, id: "q2-earlier", topic: "systems", type: "attempt.recorded", occurred_at: "2026-01-01T00:00:01.0000000001Z", data: { question_id: "q2", concept_id: "review", answer: "earlier", correct: true, assistance: "none" } },
      { schema_version: 1, id: "q1-later", topic: "systems", type: "attempt.recorded", occurred_at: "2026-01-01T00:00:01.0000000002Z", data: { question_id: "q1", concept_id: "review", answer: "later", correct: true, assistance: "none" } },
    ];

    const state = projectEvents(events, { asOf: "2026-01-01T00:00:02Z" });

    expect(state.review_history[0]).toMatchObject({ status: "completed", completion_event_id: "q2-earlier" });
  });

  test("rejects semantically invalid RFC 3339 projection timestamps", () => {
    expect(() => projectEvents([], { asOf: "2026-02-30T00:00:00Z" })).toThrow("invalid projection asOf");
    expect(() => projectEvents([], { asOf: "2026-01-01T24:00:00Z" })).toThrow("invalid projection asOf");
  });

  test("replays the same ledger to byte-stable, explicitly ordered state", () => {
    const events = [
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 0),
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 1),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "What is A?", source_refs: ["sources/book.md#a"] }, 2),
    ];

    const first = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });
    const second = projectEvents(structuredClone(events), { asOf: "2026-01-02T00:00:00.000Z" });

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.concepts.map((concept) => concept.concept_id)).toEqual(["a", "b"]);
    expect(first.questions.map((question) => question.question_id)).toEqual(["qa"]);
    expect(first.concepts[0]?.evidence_event_ids).toEqual(["c-a", "q-a"]);
  });

  test("distinguishes assistance from qualifying evidence for stable promotion", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "loops", title: "Loops", source_refs: ["sources/book.md#loops"] }, 0),
      event("q1", "question.asked", { question_id: "q1", concept_id: "loops", prompt: "Trace loop one", source_refs: ["sources/book.md#loops"] }, 1),
      event("a-hint", "attempt.recorded", { question_id: "q1", concept_id: "loops", answer: "3", correct: true, assistance: "hint" }, 2),
      event("q2", "question.asked", { question_id: "q2", concept_id: "loops", prompt: "Trace loop two", source_refs: ["sources/book.md#loops"] }, 3),
      event("a-q2", "attempt.recorded", { question_id: "q2", concept_id: "loops", answer: "4", correct: true, assistance: "none" }, 4),
      event("q3", "question.asked", { question_id: "q3", concept_id: "loops", prompt: "Trace loop three", source_refs: ["sources/book.md#loops"] }, 5),
      event("a-q3", "attempt.recorded", { question_id: "q3", concept_id: "loops", answer: "5", correct: true, assistance: "none" }, 6),
    ];

    const state = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });

    expect(state.concepts[0]?.assisted_correct_attempts).toBe(1);
    expect(state.concepts[0]?.unassisted_correct_attempts).toBe(2);
    expect(state.concepts[0]?.status).toBe("stable");
    expect(state.promotion_candidates[0]?.qualifying_evidence_event_ids).toEqual(["a-q2", "a-q3"]);
  });

  test("creates misconceptions and delayed reviews with state-change provenance", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "locks", title: "Locks", source_refs: ["sources/lecture.md#locks"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "locks", prompt: "Why acquire a lock?", source_refs: ["sources/lecture.md#locks"] }, 1),
      event("wrong-1", "attempt.recorded", { question_id: "q", concept_id: "locks", answer: "for speed", correct: false, assistance: "none" }, 2),
      event("m-1", "misconception.observed", { misconception_id: "locks-speed", concept_id: "locks", description: "Treats exclusion as an optimization", evidence_event_ids: ["wrong-1"] }, 3),
      event("r-1", "review.scheduled", { concept_id: "locks", due_at: "2026-01-04T00:00:00.000Z", reason_event_ids: ["m-1"] }, 4),
    ];

    const state = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });

    expect(state.misconceptions[0]?.status).toBe("open");
    expect(state.misconceptions[0]?.evidence_event_ids).toEqual(["wrong-1", "m-1"]);
    expect(state.review_queue[0]?.status).toBe("scheduled");
    expect(state.review_queue[0]?.reason_event_ids).toEqual(["m-1"]);
    expect(state.concepts[0]?.state_history).toEqual([
      { status: "introduced", evidence_event_ids: ["c"] },
      { status: "developing", evidence_event_ids: ["wrong-1"] },
    ]);
  });

  test("rejects scheduling a review without a question to present", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "review", title: "Review", source_refs: ["sources/book.md#review"] }, 0),
      event("r", "review.scheduled", { concept_id: "review", due_at: "2026-01-04T00:00:00.000Z", reason_event_ids: ["c"] }, 1),
    ];

    expect(() => projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" })).toThrow("review requires a question");
  });

  test("orders projected reviews by parsed due instant", () => {
    const events = [
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "Review A", source_refs: ["sources/book.md#a"] }, 1),
      event("r-a", "review.scheduled", { concept_id: "a", due_at: "2026-01-02T00:30:00+02:00", reason_event_ids: ["q-a"] }, 2),
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 3),
      event("q-b", "question.asked", { question_id: "qb", concept_id: "b", prompt: "Review B", source_refs: ["sources/book.md#b"] }, 4),
      event("r-b", "review.scheduled", { concept_id: "b", due_at: "2026-01-01T23:00:00Z", reason_event_ids: ["q-b"] }, 5),
    ];

    const state = projectEvents(events, { asOf: "2026-01-03T00:00:00.000Z" });

    expect(state.review_queue.map((review) => review.concept_id)).toEqual(["a", "b"]);
  });

  test("rejects a tutor action whose question belongs to another concept", () => {
    const events = [
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "Question A", source_refs: ["sources/book.md#a"] }, 1),
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 2),
      event("action", "tutor.action", { action: "give_hint", concept_id: "b", question_id: "qa", reason_codes: ["minimal_assistance"], evidence_event_ids: ["q-a"] }, 3),
    ];

    expect(() => projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" })).toThrow("does not belong to concept");
  });

  test("rejects a schedule-review action without a delayed due time", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "review", title: "Review", source_refs: ["sources/book.md#review"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "review", prompt: "Review question", source_refs: ["sources/book.md#review"] }, 1),
      event("action", "tutor.action", { action: "schedule_review", concept_id: "review", due_at: "2026-01-01T00:02:00.000Z", reason_codes: ["delayed_review"], evidence_event_ids: ["q"] }, 3),
    ];

    expect(() => projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" })).toThrow("schedule-review action must be delayed");
  });

  test("applies correction events without treating history as rewritten", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "jsonl", title: "JSONL", source_refs: ["sources/book.md#jsonl"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "jsonl", prompt: "What separates records?", source_refs: ["sources/book.md#jsonl"] }, 1),
      event("attempt", "attempt.recorded", { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, 2),
      event("fix", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: true, assistance: "none" }, reason: "scoring error" }, 3),
    ];

    const state = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });

    expect(events).toHaveLength(4);
    expect(state.concepts[0]?.unassisted_correct_attempts).toBe(1);
    expect(state.concepts[0]?.incorrect_attempts).toBe(0);
    expect(state.concepts[0]?.evidence_event_ids).toContain("fix");
    expect(state.applied_corrections).toEqual([{ correction_event_id: "fix", corrected_event_id: "attempt" }]);
  });

  test("uses the correction with the latest occurred-at instant instead of append order", () => {
    const original = [
      event("c", "concept.declared", { concept_id: "jsonl", title: "JSONL", source_refs: ["sources/book.md#jsonl"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "jsonl", prompt: "What separates records?", source_refs: ["sources/book.md#jsonl"] }, 1),
      event("attempt", "attempt.recorded", { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, 2),
    ];
    const newer = event("fix-newer", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: true, assistance: "none" }, reason: "newer scoring check" }, 10);
    const older = event("fix-older", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, reason: "older scoring check" }, 9);

    const state = projectEvents([...original, newer, older], { asOf: "2026-01-02T00:00:00.000Z" });

    expect(state.concepts[0]?.unassisted_correct_attempts).toBe(1);
    expect(state.concepts[0]?.incorrect_attempts).toBe(0);
    expect(state.applied_corrections).toEqual([{ correction_event_id: "fix-newer", corrected_event_id: "attempt" }]);
  });

  test("orders corrections at exact sub-millisecond RFC 3339 instants", () => {
    const original = [
      event("c", "concept.declared", { concept_id: "jsonl", title: "JSONL", source_refs: ["sources/book.md#jsonl"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "jsonl", prompt: "What separates records?", source_refs: ["sources/book.md#jsonl"] }, 1),
      event("attempt", "attempt.recorded", { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, 2),
    ];
    const earlier = {
      ...event("fix-z", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, reason: "earlier" }, 10),
      occurred_at: "2026-01-01T00:10:00.0001Z",
    };
    const later = {
      ...event("fix-a", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: true, assistance: "none" }, reason: "later" }, 10),
      occurred_at: "2026-01-01T00:10:00.0002Z",
    };

    const state = projectEvents([...original, later, earlier], { asOf: "2026-01-02T00:00:00Z" });

    expect(state.concepts[0]?.unassisted_correct_attempts).toBe(1);
    expect(state.concepts[0]?.incorrect_attempts).toBe(0);
    expect(state.applied_corrections).toEqual([{ correction_event_id: "fix-a", corrected_event_id: "attempt" }]);
  });

  test("breaks equal-time correction ties by event id independent of append order", () => {
    const original = [
      event("c", "concept.declared", { concept_id: "jsonl", title: "JSONL", source_refs: ["sources/book.md#jsonl"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "jsonl", prompt: "What separates records?", source_refs: ["sources/book.md#jsonl"] }, 1),
      event("attempt", "attempt.recorded", { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, 2),
    ];
    const winner = event("fix-z", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: true, assistance: "none" }, reason: "tie winner" }, 10);
    const other = event("fix-a", "event.corrected", { corrects_event_id: "attempt", replacement_data: { question_id: "q", concept_id: "jsonl", answer: "newline", correct: false, assistance: "none" }, reason: "tie loser" }, 10);

    const forward = projectEvents([...original, winner, other], { asOf: "2026-01-02T00:00:00.000Z" });
    const reverse = projectEvents([...original, other, winner], { asOf: "2026-01-02T00:00:00.000Z" });

    expect(forward.concepts[0]?.unassisted_correct_attempts).toBe(1);
    expect(JSON.stringify(forward.concepts)).toBe(JSON.stringify(reverse.concepts));
  });

  test("bounds replay and correction application by as-of time", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "time", title: "Original", source_refs: ["sources/book.md#time"] }, 0),
      { ...event("future-q", "question.asked", { question_id: "future", concept_id: "time", prompt: "Future question", source_refs: ["sources/book.md#time"] }, 1), occurred_at: "2026-01-03T00:00:00.000Z" },
      { ...event("future-fix", "event.corrected", { corrects_event_id: "c", replacement_data: { concept_id: "time", title: "Corrected", source_refs: ["sources/book.md#time"] }, reason: "later source check" }, 2), occurred_at: "2026-01-04T00:00:00.000Z" },
    ];

    const before = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });
    const after = projectEvents(events, { asOf: "2026-01-05T00:00:00.000Z" });

    expect(before.concepts[0]?.title).toBe("Original");
    expect(before.questions).toHaveLength(0);
    expect(before.applied_corrections).toHaveLength(0);
    expect(after.concepts[0]?.title).toBe("Corrected");
    expect(after.questions).toHaveLength(1);
  });

  test("cites attempts from distinct questions for stable state", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "stable", title: "Stable", source_refs: ["sources/book.md#stable"] }, 0),
      event("q1", "question.asked", { question_id: "q1", concept_id: "stable", prompt: "One", source_refs: ["sources/book.md#stable"] }, 1),
      event("a1", "attempt.recorded", { question_id: "q1", concept_id: "stable", answer: "one", correct: true, assistance: "none" }, 2),
      event("q2", "question.asked", { question_id: "q2", concept_id: "stable", prompt: "Two", source_refs: ["sources/book.md#stable"] }, 3),
      event("a2", "attempt.recorded", { question_id: "q2", concept_id: "stable", answer: "two", correct: true, assistance: "none" }, 4),
      event("a3", "attempt.recorded", { question_id: "q2", concept_id: "stable", answer: "two again", correct: true, assistance: "none" }, 5),
    ];

    const state = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });
    const stableChange = state.concepts[0]?.state_history.find((change) => change.status === "stable");

    expect(stableChange?.evidence_event_ids).toEqual(["a1", "a3"]);
    expect(state.promotion_candidates[0]?.qualifying_evidence_event_ids).toEqual(["a1", "a3"]);
  });

  test("cites the misconception resolution that enables stable state", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "repair", title: "Repair", source_refs: ["sources/book.md#repair"] }, 0),
      event("q1", "question.asked", { question_id: "q1", concept_id: "repair", prompt: "One", source_refs: ["sources/book.md#repair"] }, 1),
      event("wrong", "attempt.recorded", { question_id: "q1", concept_id: "repair", answer: "wrong", correct: false, assistance: "none" }, 2),
      event("m", "misconception.observed", { misconception_id: "m", concept_id: "repair", description: "Incorrect model", evidence_event_ids: ["wrong"] }, 3),
      event("a1", "attempt.recorded", { question_id: "q1", concept_id: "repair", answer: "one", correct: true, assistance: "none" }, 4),
      event("q2", "question.asked", { question_id: "q2", concept_id: "repair", prompt: "Two", source_refs: ["sources/book.md#repair"] }, 5),
      event("a2", "attempt.recorded", { question_id: "q2", concept_id: "repair", answer: "two", correct: true, assistance: "none" }, 6),
      event("resolved", "misconception.resolved", { misconception_id: "m", evidence_event_ids: ["a1", "a2"] }, 7),
    ];

    const state = projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" });
    const stableChange = state.concepts[0]?.state_history.find((change) => change.status === "stable");

    expect(stableChange?.evidence_event_ids).toEqual(["a1", "a2", "resolved"]);
    expect(state.concepts[0]?.status).toBe("stable");
  });

  test("rejects resolving an already resolved misconception", () => {
    const events = [
      event("c", "concept.declared", { concept_id: "repair", title: "Repair", source_refs: ["book.md"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "repair", prompt: "How are corrections represented?", source_refs: ["book.md"] }, 1),
      event("a", "attempt.recorded", { question_id: "q", concept_id: "repair", answer: "by mutation", correct: false, assistance: "none" }, 2),
      event("m", "misconception.observed", { misconception_id: "m1", concept_id: "repair", description: "Confuses replacement with mutation", evidence_event_ids: ["a"] }, 3),
      event("r1", "misconception.resolved", { misconception_id: "m1", evidence_event_ids: ["a"] }, 4),
      event("r2", "misconception.resolved", { misconception_id: "m1", evidence_event_ids: ["a"] }, 5),
    ];

    expect(() => projectEvents(events, { asOf: "2026-01-02T00:00:00.000Z" })).toThrow("misconception already resolved");
  });

  test("publishes projection files as one manifest-addressed generation", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-projection-"));
    try {
      const projection = projectEvents([
        event("c", "concept.declared", { concept_id: "manifest", title: "Manifest", source_refs: ["sources/book.md#manifest"] }, 0),
      ], { asOf: "2026-01-02T00:00:00.000Z" });

      writeProjections(root, projection);

      const manifest = JSON.parse(readFileSync(join(root, "projections", "current.json"), "utf8")) as {
        generation_id: string;
        files: string[];
      };
      expect(manifest.files).toEqual([
        "concepts.json",
        "misconceptions.json",
        "questions.json",
        "review-history.json",
        "review-queue.json",
        "topic-state.json",
      ]);
      const generation = join(root, "projections", "generations", manifest.generation_id);
      const topicState = JSON.parse(readFileSync(join(generation, "topic-state.json"), "utf8")) as TopicProjection;
      expect(topicState).toEqual(projection);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps the prior generation current when publication stops before the manifest swap", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-projection-crash-"));
    try {
      const initial = projectEvents([
        event("c-one", "concept.declared", { concept_id: "one", title: "One", source_refs: ["sources/book.md#one"] }, 0),
      ], { asOf: "2026-01-02T00:00:00.000Z" });
      writeProjections(root, initial);
      const manifestPath = join(root, "projections", "current.json");
      const priorManifest = readFileSync(manifestPath, "utf8");
      const updated = projectEvents([
        event("c-two", "concept.declared", { concept_id: "two", title: "Two", source_refs: ["sources/book.md#two"] }, 0),
      ], { asOf: "2026-01-03T00:00:00.000Z" });

      expect(() => writeProjections(root, updated, { beforePublish: () => { throw new Error("forced publication stop"); } }))
        .toThrow("forced publication stop");

      expect(readFileSync(manifestPath, "utf8")).toBe(priorManifest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps every published generation internally consistent across concurrent writer processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-projection-concurrent-"));
    try {
      const first = projectEvents([
        event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      ], { asOf: "2026-01-02T00:00:00.000Z" });
      const second = projectEvents([
        event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 0),
        event("q-b", "question.asked", { question_id: "qb", concept_id: "b", prompt: "What is B?", source_refs: ["sources/book.md#b"] }, 1),
      ], { asOf: "2026-01-03T00:00:00.000Z" });
      const firstPath = join(root, "first.json");
      const secondPath = join(root, "second.json");
      writeFileSync(firstPath, JSON.stringify(first));
      writeFileSync(secondPath, JSON.stringify(second));
      const processes = Array.from({ length: 8 }, (_, index) => Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "projection-writer.ts"),
        root,
        index % 2 === 0 ? firstPath : secondPath,
        "publish",
      ], { stdout: "pipe", stderr: "pipe" }));

      expect(await Promise.all(processes.map((child) => child.exited))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);

      const manifest = JSON.parse(readFileSync(join(root, "projections", "current.json"), "utf8")) as { generation_id: string };
      const generation = join(root, "projections", "generations", manifest.generation_id);
      const state = JSON.parse(readFileSync(join(generation, "topic-state.json"), "utf8")) as TopicProjection;
      expect(JSON.parse(readFileSync(join(generation, "concepts.json"), "utf8"))).toEqual(state.concepts);
      expect(JSON.parse(readFileSync(join(generation, "questions.json"), "utf8"))).toEqual(state.questions);
      expect(["a", "b"]).toContain(state.concepts[0]!.concept_id);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 20_000);

  test("a writer process killed before manifest publication cannot expose its generation", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-projection-process-crash-"));
    try {
      const initial = projectEvents([
        event("c-old", "concept.declared", { concept_id: "old", title: "Old", source_refs: ["sources/book.md#old"] }, 0),
      ], { asOf: "2026-01-02T00:00:00.000Z" });
      writeProjections(root, initial);
      const manifestPath = join(root, "projections", "current.json");
      const priorManifest = readFileSync(manifestPath, "utf8");
      const updated = projectEvents([
        event("c-new", "concept.declared", { concept_id: "new", title: "New", source_refs: ["sources/book.md#new"] }, 0),
      ], { asOf: "2026-01-03T00:00:00.000Z" });
      const updatedPath = join(root, "updated.json");
      writeFileSync(updatedPath, JSON.stringify(updated));
      const child = Bun.spawn([
        process.execPath,
        join(import.meta.dir, "fixtures", "projection-writer.ts"),
        root,
        updatedPath,
        "crash-before-publish",
      ], { stdout: "pipe", stderr: "pipe" });

      expect(await child.exited).toBe(73);
      expect(readFileSync(manifestPath, "utf8")).toBe(priorManifest);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
