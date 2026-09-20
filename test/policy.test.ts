import { describe, expect, test } from "bun:test";
import { selectTutorAction } from "../src/policy.ts";
import { projectEvents } from "../src/projection.ts";
import type { LedgerEvent } from "../src/types.ts";

const event = (id: string, type: LedgerEvent["type"], data: Record<string, unknown>, minute: number): LedgerEvent => ({
  schema_version: 1,
  id,
  topic: "policy",
  type,
  occurred_at: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
  data,
});

describe("rule-based tutor policy", () => {
  test("prioritizes one due review and emits inspectable reasons", () => {
    const state = projectEvents([
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "Review A", source_refs: ["sources/book.md#a"] }, 1),
      event("r-a", "review.scheduled", { concept_id: "a", due_at: "2026-01-02T00:00:00.000Z", reason_event_ids: ["q-a"] }, 2),
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 3),
      event("q-b", "question.asked", { question_id: "qb", concept_id: "b", prompt: "Try B", source_refs: ["sources/book.md#b"] }, 4),
    ], { asOf: "2026-01-03T00:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("ask_due_review");
    expect(decision.concept_id).toBe("a");
    expect(decision.question_id).toBe("qa");
    expect(decision.reason_codes).toEqual(["due_review_priority", "single_bottleneck"]);
    expect(decision.evidence_event_ids).toEqual(["r-a", "q-a"]);
  });

  test("orders offset due reviews by parsed instant", () => {
    const state = projectEvents([
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "Review A", source_refs: ["sources/book.md#a"] }, 1),
      event("r-a", "review.scheduled", { concept_id: "a", due_at: "2026-01-02T00:30:00+02:00", reason_event_ids: ["q-a"] }, 2),
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 3),
      event("q-b", "question.asked", { question_id: "qb", concept_id: "b", prompt: "Review B", source_refs: ["sources/book.md#b"] }, 4),
      event("r-b", "review.scheduled", { concept_id: "b", due_at: "2026-01-01T23:00:00Z", reason_event_ids: ["q-b"] }, 5),
    ], { asOf: "2026-01-03T00:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(Date.parse("2026-01-02T00:30:00+02:00")).toBeLessThan(Date.parse("2026-01-01T23:00:00Z"));
    expect(decision.action).toBe("ask_due_review");
    expect(decision.concept_id).toBe("a");
    expect(decision.question_id).toBe("qa");
  });

  test("orders due reviews at exact sub-millisecond RFC 3339 instants", () => {
    const state = projectEvents([
      event("c-a", "concept.declared", { concept_id: "a", title: "A", source_refs: ["sources/book.md#a"] }, 0),
      event("q-a", "question.asked", { question_id: "qa", concept_id: "a", prompt: "Review A", source_refs: ["sources/book.md#a"] }, 1),
      event("r-a", "review.scheduled", { concept_id: "a", due_at: "2026-01-02T00:00:00.0002Z", reason_event_ids: ["q-a"] }, 2),
      event("c-b", "concept.declared", { concept_id: "b", title: "B", source_refs: ["sources/book.md#b"] }, 3),
      event("q-b", "question.asked", { question_id: "qb", concept_id: "b", prompt: "Review B", source_refs: ["sources/book.md#b"] }, 4),
      event("r-b", "review.scheduled", { concept_id: "b", due_at: "2026-01-02T00:00:00.0001Z", reason_event_ids: ["q-b"] }, 5),
    ], { asOf: "2026-01-03T00:00:00Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("ask_due_review");
    expect(decision.concept_id).toBe("b");
    expect(decision.question_id).toBe("qb");
  });

  test("elicits evidence before offering an explanation", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "proof", title: "Proof", source_refs: ["sources/lecture.md#proof"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "proof", prompt: "State the invariant", source_refs: ["sources/lecture.md#proof"] }, 1),
    ], { asOf: "2026-01-01T01:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("elicit_attempt");
    expect(decision.reason_codes).toEqual(["evidence_before_explanation", "single_bottleneck"]);
    expect(decision.evidence_event_ids).toEqual(["q"]);
  });

  test("uses minimal assistance for the selected bottleneck", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "mutex", title: "Mutex", source_refs: ["sources/lecture.md#mutex"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "mutex", prompt: "What does a mutex protect?", source_refs: ["sources/lecture.md#mutex"] }, 1),
      event("wrong", "attempt.recorded", { question_id: "q", concept_id: "mutex", answer: "the CPU", correct: false, assistance: "none" }, 2),
    ], { asOf: "2026-01-01T01:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("give_hint");
    expect(decision.concept_id).toBe("mutex");
    expect(decision.reason_codes).toEqual(["minimal_assistance", "single_bottleneck"]);
    expect(decision.evidence_event_ids).toEqual(["wrong"]);
  });

  test("escalates after one recorded hint instead of repeating it", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "mutex", title: "Mutex", source_refs: ["sources/lecture.md#mutex"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "mutex", prompt: "What does a mutex protect?", source_refs: ["sources/lecture.md#mutex"] }, 1),
      event("wrong", "attempt.recorded", { question_id: "q", concept_id: "mutex", answer: "the CPU", correct: false, assistance: "none" }, 2),
      event("hint-action", "tutor.action", {
        action: "give_hint",
        concept_id: "mutex",
        question_id: "q",
        reason_codes: ["minimal_assistance", "single_bottleneck"],
        evidence_event_ids: ["wrong"],
      }, 3),
    ], { asOf: "2026-01-01T01:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("explain_bottleneck");
    expect(decision.concept_id).toBe("mutex");
    expect(decision.question_id).toBe("q");
    expect(decision.reason_codes).toEqual(["hint_limit_reached", "single_bottleneck"]);
    expect(decision.evidence_event_ids).toEqual(["wrong", "hint-action"]);
  });

  test("explains only after evidence shows a hint was insufficient", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "mutex", title: "Mutex", source_refs: ["sources/lecture.md#mutex"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "mutex", prompt: "What does a mutex protect?", source_refs: ["sources/lecture.md#mutex"] }, 1),
      event("wrong", "attempt.recorded", { question_id: "q", concept_id: "mutex", answer: "the CPU", correct: false, assistance: "none" }, 2),
      event("wrong-hint", "attempt.recorded", { question_id: "q", concept_id: "mutex", answer: "a process", correct: false, assistance: "hint" }, 3),
    ], { asOf: "2026-01-01T01:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("explain_bottleneck");
    expect(decision.reason_codes).toEqual(["hint_insufficient", "single_bottleneck"]);
    expect(decision.evidence_event_ids).toEqual(["wrong", "wrong-hint"]);
  });

  test("schedules delayed review after stable evidence", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "append", title: "Append", source_refs: ["sources/book.md#append"] }, 0),
      event("q1", "question.asked", { question_id: "q1", concept_id: "append", prompt: "Why append?", source_refs: ["sources/book.md#append"] }, 1),
      event("a1", "attempt.recorded", { question_id: "q1", concept_id: "append", answer: "history", correct: true, assistance: "none" }, 2),
      event("q2", "question.asked", { question_id: "q2", concept_id: "append", prompt: "How correct?", source_refs: ["sources/book.md#append"] }, 3),
      event("a2", "attempt.recorded", { question_id: "q2", concept_id: "append", answer: "new event", correct: true, assistance: "none" }, 4),
    ], { asOf: "2026-01-01T01:00:00.000Z" });

    const decision = selectTutorAction(state);

    expect(decision.action).toBe("schedule_review");
    expect(decision.reason_codes).toEqual(["stable_evidence", "delayed_review"]);
    expect(decision.evidence_event_ids).toEqual(["a1", "a2"]);
    expect(decision.due_at).toBe("2026-01-04T01:00:00.000Z");
  });

  test("retires a due review after unassisted correct review evidence", () => {
    const state = projectEvents([
      event("c", "concept.declared", { concept_id: "review", title: "Review", source_refs: ["sources/book.md#review"] }, 0),
      event("q", "question.asked", { question_id: "q", concept_id: "review", prompt: "Review it", source_refs: ["sources/book.md#review"] }, 1),
      event("r", "review.scheduled", { concept_id: "review", due_at: "2026-01-02T00:00:00.000Z", reason_event_ids: ["q"] }, 2),
      { ...event("review-pass", "attempt.recorded", { question_id: "q", concept_id: "review", answer: "correct", correct: true, assistance: "none" }, 3), occurred_at: "2026-01-03T00:00:00.000Z" },
    ], { asOf: "2026-01-04T00:00:00.000Z" });

    expect(state.review_queue).toHaveLength(0);
    expect(state.review_history[0]).toMatchObject({ status: "completed", completion_event_id: "review-pass" });
    expect(selectTutorAction(state).action).not.toBe("ask_due_review");
  });
});
