import type { TopicProjection } from "./projection.ts";
import { compareRfc3339Instants } from "./json-schema.ts";

export type TutorAction = "elicit_attempt" | "give_hint" | "explain_bottleneck" | "ask_due_review" | "schedule_review" | "complete";
export interface TutorDecision {
  action: TutorAction;
  concept_id?: string;
  question_id?: string;
  due_at?: string;
  reason_codes: string[];
  evidence_event_ids: string[];
}

export function selectTutorAction(state: TopicProjection): TutorDecision {
  const due = state.review_queue.filter((review) => review.status === "due")
    .sort((left, right) => compareRfc3339Instants(left.due_at, right.due_at) || left.concept_id.localeCompare(right.concept_id))[0];
  if (due) {
    const question = state.questions.find((candidate) => candidate.concept_id === due.concept_id);
    return {
      action: "ask_due_review",
      concept_id: due.concept_id,
      ...(question ? { question_id: question.question_id } : {}),
      reason_codes: ["due_review_priority", "single_bottleneck"],
      evidence_event_ids: [due.scheduled_event_id, ...due.reason_event_ids],
    };
  }
  const unanswered = state.questions.filter((question) => question.attempts.length === 0)
    .sort((left, right) => left.concept_id.localeCompare(right.concept_id) || left.question_id.localeCompare(right.question_id))[0];
  if (unanswered) {
    return {
      action: "elicit_attempt",
      concept_id: unanswered.concept_id,
      question_id: unanswered.question_id,
      reason_codes: ["evidence_before_explanation", "single_bottleneck"],
      evidence_event_ids: [unanswered.evidence_event_ids[0]!],
    };
  }
  const needsExplanation = state.questions.filter((question) => {
    const latest = question.attempts.at(-1);
    return latest?.correct === false && latest.assistance !== "none";
  }).sort((left, right) => left.concept_id.localeCompare(right.concept_id) || left.question_id.localeCompare(right.question_id))[0];
  if (needsExplanation) {
    return {
      action: "explain_bottleneck",
      concept_id: needsExplanation.concept_id,
      question_id: needsExplanation.question_id,
      reason_codes: ["hint_insufficient", "single_bottleneck"],
      evidence_event_ids: needsExplanation.attempts.filter((attempt) => !attempt.correct).map((attempt) => attempt.event_id),
    };
  }
  const needsHint = state.questions.filter((question) => {
    const latest = question.attempts.at(-1);
    return latest?.correct === false && latest.assistance === "none";
  }).sort((left, right) => left.concept_id.localeCompare(right.concept_id) || left.question_id.localeCompare(right.question_id))[0];
  if (needsHint) {
    const latestAttempt = needsHint.attempts.at(-1)!;
    const priorHint = [...state.tutor_actions].reverse().find((event) => {
      const data = event.data as Record<string, unknown>;
      return data.action === "give_hint"
        && data.question_id === needsHint.question_id
        && compareRfc3339Instants(event.occurred_at, latestAttempt.occurred_at) >= 0;
    });
    if (priorHint) {
      return {
        action: "explain_bottleneck",
        concept_id: needsHint.concept_id,
        question_id: needsHint.question_id,
        reason_codes: ["hint_limit_reached", "single_bottleneck"],
        evidence_event_ids: [latestAttempt.event_id, priorHint.id],
      };
    }
    return {
      action: "give_hint",
      concept_id: needsHint.concept_id,
      question_id: needsHint.question_id,
      reason_codes: ["minimal_assistance", "single_bottleneck"],
      evidence_event_ids: [latestAttempt.event_id],
    };
  }
  const stableWithoutReview = state.concepts.find((concept) => concept.status === "stable" && !state.review_queue.some((review) => review.concept_id === concept.concept_id));
  if (stableWithoutReview) {
    const candidate = state.promotion_candidates.find((item) => item.concept_id === stableWithoutReview.concept_id)!;
    return {
      action: "schedule_review",
      concept_id: stableWithoutReview.concept_id,
      due_at: new Date(Date.parse(state.as_of) + 3 * 24 * 60 * 60 * 1_000).toISOString(),
      reason_codes: ["stable_evidence", "delayed_review"],
      evidence_event_ids: candidate.qualifying_evidence_event_ids,
    };
  }
  return {
    action: "complete",
    reason_codes: ["no_actionable_bottleneck"],
    evidence_event_ids: [],
  };
}
