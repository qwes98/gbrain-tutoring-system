import { createHash } from "node:crypto";
import { join } from "node:path";
import { atomicWriteText, fsyncDirectory } from "./atomic-file.ts";
import { compareRfc3339EventOrder, compareRfc3339Instants, isRfc3339DateTime } from "./json-schema.ts";
import { assertEvent } from "./schema.ts";
import type { Assistance, LedgerEvent } from "./types.ts";

interface ConceptState {
  concept_id: string;
  title: string;
  status: "introduced" | "developing" | "stable";
  source_refs: string[];
  evidence_event_ids: string[];
  unassisted_correct_attempts: number;
  assisted_correct_attempts: number;
  incorrect_attempts: number;
  question_ids: string[];
  open_misconception_ids: string[];
  last_attempt_correct_unassisted: boolean;
  last_event_at: string;
  state_history: Array<{ status: "introduced" | "developing" | "stable"; evidence_event_ids: string[] }>;
}

interface QuestionState {
  question_id: string;
  concept_id: string;
  prompt: string;
  source_refs: string[];
  evidence_event_ids: string[];
  attempts: Array<{ event_id: string; answer: string; correct: boolean; assistance: Assistance; occurred_at: string }>;
}

interface MisconceptionState {
  misconception_id: string;
  concept_id: string;
  description: string;
  status: "open" | "resolved";
  observed_event_id: string;
  resolved_event_id?: string;
  evidence_event_ids: string[];
}

interface ReviewState {
  concept_id: string;
  due_at: string;
  status: "scheduled" | "due" | "completed";
  scheduled_event_id: string;
  reason_event_ids: string[];
  completion_event_id?: string;
}

export interface TopicProjection {
  schema_version: 1;
  topic: string;
  as_of: string;
  concepts: ConceptState[];
  questions: QuestionState[];
  misconceptions: MisconceptionState[];
  review_queue: ReviewState[];
  review_history: ReviewState[];
  tutor_actions: LedgerEvent[];
  applied_corrections: Array<{ correction_event_id: string; corrected_event_id: string }>;
  promotion_candidates: Array<{
    schema_version: 1;
    candidate_id: string;
    topic: string;
    concept_id: string;
    title: string;
    source_refs: string[];
    evidence_event_ids: string[];
    qualifying_evidence_event_ids: string[];
  }>;
}

export interface ProjectionManifest {
  schema_version: 1;
  generation_id: string;
  as_of: string;
  files: string[];
}

interface ProjectionWriteHooks {
  beforePublish?: () => void;
}

interface EffectiveEvent {
  event: LedgerEvent;
  evidenceId: string;
  evidenceOccurredAt: string;
}

function pushUnique(values: string[], ...added: string[]): void {
  for (const value of added) if (!values.includes(value)) values.push(value);
}

function orderEffectiveEvents(items: EffectiveEvent[]): EffectiveEvent[] {
  const byEvidenceId = new Map<string, EffectiveEvent>();
  const concepts = new Map<string, EffectiveEvent>();
  const questions = new Map<string, EffectiveEvent>();
  const misconceptions = new Map<string, EffectiveEvent>();
  const questionsByConcept = new Map<string, EffectiveEvent[]>();
  for (const item of [...items].sort((left, right) => left.event.id.localeCompare(right.event.id))) {
    const data = item.event.data as Record<string, unknown>;
    byEvidenceId.set(item.event.id, item);
    byEvidenceId.set(item.evidenceId, item);
    if (item.event.type === "concept.declared") concepts.set(data.concept_id as string, item);
    if (item.event.type === "question.asked") {
      questions.set(data.question_id as string, item);
      const conceptId = data.concept_id as string;
      questionsByConcept.set(conceptId, [...questionsByConcept.get(conceptId) ?? [], item]);
    }
    if (item.event.type === "misconception.observed") misconceptions.set(data.misconception_id as string, item);
  }
  const dependencies = new Map<string, Set<string>>();
  for (const item of items) {
    const data = item.event.data as Record<string, unknown>;
    const ids = new Set<string>();
    const assertNotAfter = (kind: string, id: string, dependency: EffectiveEvent | undefined): void => {
      if (dependency && compareRfc3339Instants(dependency.event.occurred_at, item.event.occurred_at) > 0) {
        throw new Error(`${kind} ${id} occurs after dependent event ${item.event.id}`);
      }
    };
    const add = (dependency: EffectiveEvent | undefined): void => {
      if (dependency && dependency.event.id !== item.event.id) ids.add(dependency.event.id);
    };
    if (item.event.type !== "concept.declared" && typeof data.concept_id === "string") {
      const dependency = concepts.get(data.concept_id);
      assertNotAfter("concept", data.concept_id, dependency);
      add(dependency);
    }
    if (typeof data.question_id === "string") {
      const dependency = questions.get(data.question_id);
      assertNotAfter("question", data.question_id, dependency);
      add(dependency);
    }
    if (item.event.type === "misconception.resolved" && typeof data.misconception_id === "string") {
      const dependency = misconceptions.get(data.misconception_id);
      assertNotAfter("misconception", data.misconception_id, dependency);
      add(dependency);
    }
    for (const field of ["evidence_event_ids", "reason_event_ids"] as const) {
      if (Array.isArray(data[field])) for (const id of data[field] as string[]) add(byEvidenceId.get(id));
    }
    if (item.event.type === "review.scheduled" && typeof data.concept_id === "string") {
      for (const question of questionsByConcept.get(data.concept_id) ?? []) add(question);
    }
    dependencies.set(item.event.id, ids);
  }

  const chronological = [...items].sort((left, right) => compareRfc3339EventOrder(
    left.event.occurred_at,
    left.event.id,
    right.event.occurred_at,
    right.event.id,
  ));
  const ordered: EffectiveEvent[] = [];
  for (let start = 0; start < chronological.length;) {
    let end = start + 1;
    while (end < chronological.length && compareRfc3339Instants(
      chronological[start]!.event.occurred_at,
      chronological[end]!.event.occurred_at,
    ) === 0) end += 1;
    const pending = new Map(chronological.slice(start, end).map((item) => [item.event.id, item]));
    while (pending.size > 0) {
      const ready = [...pending.values()]
        .filter((item) => [...dependencies.get(item.event.id) ?? []].every((id) => !pending.has(id)))
        .sort((left, right) => left.event.id.localeCompare(right.event.id))[0];
      if (!ready) throw new Error(`cyclic same-instant event dependencies: ${[...pending.keys()].sort().join(", ")}`);
      ordered.push(ready);
      pending.delete(ready.event.id);
    }
    start = end;
  }
  return ordered;
}

function effectiveEvents(events: LedgerEvent[]): {
  events: EffectiveEvent[];
  corrections: Array<{ correction_event_id: string; corrected_event_id: string }>;
} {
  const known = new Map<string, LedgerEvent>();
  const replacements = new Map<string, { data: Record<string, unknown>; evidenceId: string; evidenceOccurredAt: string }>();
  for (const event of events) {
    assertEvent(event);
    if (known.has(event.id)) throw new Error(`duplicate event id during replay: ${event.id}`);
    known.set(event.id, event);
  }
  for (const event of events) {
    if (event.type === "event.corrected") {
      const data = event.data as { corrects_event_id: string; replacement_data: Record<string, unknown> };
      const target = known.get(data.corrects_event_id);
      if (!target || target.type === "event.corrected") throw new Error(`invalid correction target: ${data.corrects_event_id}`);
      if (target.topic !== event.topic) throw new Error(`mixed topics in correction: ${target.topic} and ${event.topic}`);
      if (compareRfc3339Instants(event.occurred_at, target.occurred_at) < 0) throw new Error(`correction predates target: ${event.id}`);
      assertEvent({ ...target, data: data.replacement_data });
      const current = replacements.get(target.id);
      const instantOrder = current ? compareRfc3339Instants(event.occurred_at, current.evidenceOccurredAt) : 1;
      if (!current || instantOrder > 0 || (instantOrder === 0 && event.id.localeCompare(current.evidenceId) > 0)) {
        replacements.set(target.id, { data: data.replacement_data, evidenceId: event.id, evidenceOccurredAt: event.occurred_at });
      }
    }
  }
  const effective = events.filter((event) => event.type !== "event.corrected")
    .map((event) => {
      const replacement = replacements.get(event.id);
      return replacement
        ? { event: { ...event, data: replacement.data }, evidenceId: replacement.evidenceId, evidenceOccurredAt: replacement.evidenceOccurredAt }
        : { event, evidenceId: event.id, evidenceOccurredAt: event.occurred_at };
    });
  const corrections = [...replacements.entries()]
    .map(([corrected_event_id, replacement]) => ({ correction_event_id: replacement.evidenceId, corrected_event_id }))
    .sort((left, right) => left.corrected_event_id.localeCompare(right.corrected_event_id) || left.correction_event_id.localeCompare(right.correction_event_id));
  return { events: orderEffectiveEvents(effective), corrections };
}

export function projectEvents(events: LedgerEvent[], options: { asOf: string }): TopicProjection {
  if (!isRfc3339DateTime(options.asOf)) throw new Error(`invalid projection asOf: ${options.asOf}`);
  for (const event of events) assertEvent(event);
  const includedEvents = events.filter((event) => compareRfc3339Instants(event.occurred_at, options.asOf) <= 0);
  const topic = includedEvents[0]?.topic ?? "unknown";
  for (const event of includedEvents) if (event.topic !== topic) throw new Error(`mixed topics in ledger: ${topic} and ${event.topic}`);
  const { events: effective, corrections } = effectiveEvents(includedEvents);
  const concepts = new Map<string, ConceptState>();
  const questions = new Map<string, QuestionState>();
  const misconceptions = new Map<string, MisconceptionState>();
  const reviews: ReviewState[] = [];
  const tutorActions: LedgerEvent[] = [];
  const seenEvidence = new Map<string, string>();
  const conceptDeclaredAt = new Map<string, string>();
  const questionDeclaredAt = new Map<string, string>();
  const misconceptionObservedAt = new Map<string, string>();

  const assertDependencyTime = (kind: string, id: string, dependencyAt: string, event: LedgerEvent): void => {
    if (compareRfc3339Instants(dependencyAt, event.occurred_at) > 0) throw new Error(`${kind} ${id} occurs after dependent event ${event.id}`);
  };
  const assertEvidenceRefs = (refs: string[], event: LedgerEvent, label: string): void => {
    for (const ref of refs) {
      const occurredAt = seenEvidence.get(ref);
      if (!occurredAt) throw new Error(`${label} references unknown prior evidence: ${ref}`);
      assertDependencyTime("evidence", ref, occurredAt, event);
    }
  };

  const conceptFor = (id: string, event: LedgerEvent): ConceptState => {
    const concept = concepts.get(id);
    if (!concept) throw new Error(`event references undeclared concept: ${id}`);
    assertDependencyTime("concept", id, conceptDeclaredAt.get(id)!, event);
    return concept;
  };
  const setConceptStatus = (concept: ConceptState, status: ConceptState["status"], evidenceIds: string[]): void => {
    if (concept.status === status) return;
    concept.status = status;
    concept.state_history.push({ status, evidence_event_ids: [...evidenceIds] });
  };

  for (const { event, evidenceId, evidenceOccurredAt } of effective) {
    if (event.topic !== topic) throw new Error(`mixed topics in ledger: ${topic} and ${event.topic}`);
    const data = event.data as Record<string, unknown>;
    if (event.type === "concept.declared") {
      const conceptId = data.concept_id as string;
      if (concepts.has(conceptId)) throw new Error(`concept already declared: ${conceptId}`);
      concepts.set(conceptId, {
        concept_id: conceptId,
        title: data.title as string,
        status: "introduced",
        source_refs: [...data.source_refs as string[]],
        evidence_event_ids: [evidenceId],
        unassisted_correct_attempts: 0,
        assisted_correct_attempts: 0,
        incorrect_attempts: 0,
        question_ids: [],
        open_misconception_ids: [],
        last_attempt_correct_unassisted: false,
        last_event_at: event.occurred_at,
        state_history: [{ status: "introduced", evidence_event_ids: [evidenceId] }],
      });
      conceptDeclaredAt.set(conceptId, event.occurred_at);
    } else if (event.type === "question.asked") {
      const concept = conceptFor(data.concept_id as string, event);
      const questionId = data.question_id as string;
      if (questions.has(questionId)) throw new Error(`question already declared: ${questionId}`);
      questions.set(questionId, { question_id: questionId, concept_id: concept.concept_id, prompt: data.prompt as string, source_refs: [...data.source_refs as string[]], evidence_event_ids: [evidenceId], attempts: [] });
      questionDeclaredAt.set(questionId, event.occurred_at);
      pushUnique(concept.question_ids, questionId);
      pushUnique(concept.evidence_event_ids, evidenceId);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "attempt.recorded") {
      const concept = conceptFor(data.concept_id as string, event);
      const question = questions.get(data.question_id as string);
      if (!question || question.concept_id !== concept.concept_id) throw new Error(`attempt references unknown question: ${data.question_id}`);
      assertDependencyTime("question", question.question_id, questionDeclaredAt.get(question.question_id)!, event);
      const assistance = data.assistance as Assistance;
      const correct = data.correct as boolean;
      question.attempts.push({ event_id: evidenceId, answer: data.answer as string, correct, assistance, occurred_at: event.occurred_at });
      pushUnique(question.evidence_event_ids, evidenceId);
      pushUnique(concept.evidence_event_ids, evidenceId);
      if (correct && assistance === "none") concept.unassisted_correct_attempts += 1;
      else if (correct) concept.assisted_correct_attempts += 1;
      else concept.incorrect_attempts += 1;
      concept.last_attempt_correct_unassisted = correct && assistance === "none";
      setConceptStatus(concept, "developing", [evidenceId]);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "evidence.recorded") {
      const concept = conceptFor(data.concept_id as string, event);
      pushUnique(concept.evidence_event_ids, evidenceId);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "misconception.observed") {
      const concept = conceptFor(data.concept_id as string, event);
      const id = data.misconception_id as string;
      if (misconceptions.has(id)) throw new Error(`misconception already exists: ${id}`);
      const refs = data.evidence_event_ids as string[];
      assertEvidenceRefs(refs, event, "misconception");
      misconceptions.set(id, { misconception_id: id, concept_id: concept.concept_id, description: data.description as string, status: "open", observed_event_id: evidenceId, evidence_event_ids: [...refs, evidenceId] });
      misconceptionObservedAt.set(id, event.occurred_at);
      pushUnique(concept.open_misconception_ids, id);
      pushUnique(concept.evidence_event_ids, ...refs, evidenceId);
      setConceptStatus(concept, "developing", [evidenceId]);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "misconception.resolved") {
      const misconception = misconceptions.get(data.misconception_id as string);
      if (!misconception) throw new Error(`unknown misconception: ${data.misconception_id}`);
      if (misconception.status === "resolved") throw new Error(`misconception already resolved: ${misconception.misconception_id}`);
      assertDependencyTime("misconception", misconception.misconception_id, misconceptionObservedAt.get(misconception.misconception_id)!, event);
      const refs = data.evidence_event_ids as string[];
      assertEvidenceRefs(refs, event, "resolution");
      misconception.status = "resolved";
      misconception.resolved_event_id = evidenceId;
      pushUnique(misconception.evidence_event_ids, ...refs, evidenceId);
      const concept = conceptFor(misconception.concept_id, event);
      concept.open_misconception_ids = concept.open_misconception_ids.filter((id) => id !== misconception.misconception_id);
      pushUnique(concept.evidence_event_ids, ...refs, evidenceId);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "review.scheduled") {
      const concept = conceptFor(data.concept_id as string, event);
      if (concept.question_ids.length === 0) throw new Error(`review requires a question for concept: ${concept.concept_id}`);
      const dueAt = data.due_at as string;
      if (compareRfc3339Instants(dueAt, event.occurred_at) <= 0) throw new Error(`review must be delayed after scheduling event: ${event.id}`);
      const refs = data.reason_event_ids as string[];
      assertEvidenceRefs(refs, event, "review");
      reviews.push({ concept_id: concept.concept_id, due_at: dueAt, status: compareRfc3339Instants(dueAt, options.asOf) <= 0 ? "due" : "scheduled", scheduled_event_id: evidenceId, reason_event_ids: refs });
      pushUnique(concept.evidence_event_ids, ...refs, evidenceId);
      concept.last_event_at = event.occurred_at;
    } else if (event.type === "tutor.action") {
      const refs = data.evidence_event_ids as string[];
      assertEvidenceRefs(refs, event, "tutor action");
      if (typeof data.concept_id === "string") conceptFor(data.concept_id, event);
      if (typeof data.question_id === "string") {
        const question = questions.get(data.question_id);
        if (!question) throw new Error(`tutor action references unknown question: ${data.question_id}`);
        if (typeof data.concept_id === "string" && question.concept_id !== data.concept_id) {
          throw new Error(`tutor action question ${question.question_id} does not belong to concept ${data.concept_id}`);
        }
        assertDependencyTime("question", question.question_id, questionDeclaredAt.get(question.question_id)!, event);
      }
      if (data.action === "schedule_review" && compareRfc3339Instants(data.due_at as string, event.occurred_at) <= 0) {
        throw new Error(`schedule-review action must be delayed after action event: ${event.id}`);
      }
      tutorActions.push({ ...event, id: evidenceId });
    }
    seenEvidence.set(event.id, event.occurred_at);
    seenEvidence.set(evidenceId, evidenceOccurredAt);
  }

  const qualifyingAttempts = (conceptId: string) => [...questions.values()]
    .filter((question) => question.concept_id === conceptId)
    .flatMap((question) => {
      const attempt = question.attempts.filter((candidate) => candidate.correct && candidate.assistance === "none").at(-1);
      return attempt ? [attempt] : [];
    })
    .sort((left, right) => compareRfc3339EventOrder(left.occurred_at, left.event_id, right.occurred_at, right.event_id));

  for (const concept of concepts.values()) {
    const qualifying = qualifyingAttempts(concept.concept_id);
    if (qualifying.length >= 2 && concept.open_misconception_ids.length === 0 && concept.last_attempt_correct_unassisted) {
      const qualifyingIds = qualifying.map((attempt) => attempt.event_id);
      const resolutionIds = [...misconceptions.values()].filter((item) => item.concept_id === concept.concept_id && item.resolved_event_id)
        .map((item) => item.resolved_event_id!);
      setConceptStatus(concept, "stable", [...qualifyingIds.slice(-2), ...resolutionIds]);
    }
  }

  const reviewHistory = reviews.map((review) => {
    const completion = [...questions.values()].filter((question) => question.concept_id === review.concept_id)
      .flatMap((question) => question.attempts)
      .sort((left, right) => compareRfc3339EventOrder(left.occurred_at, left.event_id, right.occurred_at, right.event_id))
      .find((attempt) => attempt.correct && attempt.assistance === "none" && compareRfc3339Instants(attempt.occurred_at, review.due_at) >= 0);
    return completion ? { ...review, status: "completed" as const, completion_event_id: completion.event_id } : review;
  }).sort((left, right) => compareRfc3339Instants(left.due_at, right.due_at)
    || left.concept_id.localeCompare(right.concept_id)
    || left.scheduled_event_id.localeCompare(right.scheduled_event_id));

  const orderedConcepts = [...concepts.values()].sort((left, right) => left.concept_id.localeCompare(right.concept_id));
  const promotionCandidates = orderedConcepts.filter((concept) => concept.status === "stable").map((concept) => ({
    schema_version: 1 as const,
    candidate_id: `${topic}:${concept.concept_id}`,
    topic,
    concept_id: concept.concept_id,
    title: concept.title,
    source_refs: [...concept.source_refs].sort(),
    evidence_event_ids: [...concept.evidence_event_ids],
    qualifying_evidence_event_ids: qualifyingAttempts(concept.concept_id).map((attempt) => attempt.event_id),
  }));
  return {
    schema_version: 1,
    topic,
    as_of: options.asOf,
    concepts: orderedConcepts,
    questions: [...questions.values()].sort((left, right) => left.question_id.localeCompare(right.question_id)),
    misconceptions: [...misconceptions.values()].sort((left, right) => left.misconception_id.localeCompare(right.misconception_id)),
    review_queue: reviewHistory.filter((review) => review.status !== "completed"),
    review_history: reviewHistory,
    tutor_actions: tutorActions,
    applied_corrections: corrections,
    promotion_candidates: promotionCandidates,
  };
}

export function writeProjections(topicDir: string, projection: TopicProjection, hooks: ProjectionWriteHooks = {}): ProjectionManifest {
  const root = join(topicDir, "projections");
  const files: Record<string, unknown> = {
    "concepts.json": projection.concepts,
    "questions.json": projection.questions,
    "misconceptions.json": projection.misconceptions,
    "review-queue.json": projection.review_queue,
    "review-history.json": projection.review_history,
    "topic-state.json": projection,
  };
  const serialized = Object.entries(files)
    .map(([name, value]) => [name, `${JSON.stringify(value, null, 2)}\n`] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const digest = createHash("sha256");
  for (const [name, content] of serialized) digest.update(name).update("\0").update(content).update("\0");
  const generationId = digest.digest("hex");
  const generationsRoot = join(root, "generations");
  const generationRoot = join(generationsRoot, generationId);
  for (const [name, content] of serialized) {
    atomicWriteText(join(generationRoot, name), content, { containmentRoot: root });
  }
  fsyncDirectory(generationRoot);
  fsyncDirectory(generationsRoot);
  hooks.beforePublish?.();
  const manifest: ProjectionManifest = {
    schema_version: 1,
    generation_id: generationId,
    as_of: projection.as_of,
    files: serialized.map(([name]) => name),
  };
  atomicWriteText(join(root, "current.json"), `${JSON.stringify(manifest, null, 2)}\n`, { containmentRoot: root });
  return manifest;
}
