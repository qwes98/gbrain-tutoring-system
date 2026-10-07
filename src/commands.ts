import { createHash } from "node:crypto";
import { closeSync, constants, openSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openAnchoredDirectory } from "./anchored-fs.ts";
import type { CommandReceipt, TutorDecision } from "./contracts.ts";
import { readLedger, transactLedger } from "./ledger.ts";
import { selectTutorAction } from "./policy.ts";
import { projectEvents, writeProjections, type TopicProjection } from "./projection.ts";
import { readStudyReceipt } from "./study-state.ts";
import type { LedgerEvent } from "./types.ts";

export type TutorCommandResult = Record<string, unknown> & {
  decision: TutorDecision;
  context: {
    concept: { concept_id: string; title: string; status: string; source_refs: string[] } | null;
    question: { question_id: string; prompt: string; source_refs: string[] } | null;
  };
  action_event_id: string;
};

export interface TutorCommandInput { request_id: string; occurred_at: string; }

export type LedgerCommandResult = Record<string, unknown> & { event_id: string; event: LedgerEvent };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function topicSlug(topicDir: string): string {
  const root = openAnchoredDirectory(resolve(topicDir));
  try {
    const descriptor = openSync(root.child("topic.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return (JSON.parse(readFileSync(descriptor, "utf8")) as { slug: string }).slug; }
    finally { closeSync(descriptor); }
  } finally { root.close(); }
}

function tutorContext(state: TopicProjection, decision: TutorDecision): TutorCommandResult["context"] {
  const concept = decision.concept_id ? state.concepts.find((candidate) => candidate.concept_id === decision.concept_id) : undefined;
  const question = decision.question_id ? state.questions.find((candidate) => candidate.question_id === decision.question_id) : undefined;
  return {
    concept: concept ? { concept_id: concept.concept_id, title: concept.title, status: concept.status, source_refs: concept.source_refs } : null,
    question: question ? { question_id: question.question_id, prompt: question.prompt, source_refs: question.source_refs } : null,
  };
}

function requestHash(input: TutorCommandInput): string {
  return createHash("sha256").update(JSON.stringify({ command: "tutor.next", occurred_at: input.occurred_at })).digest("hex");
}

function receiptFromEvent<TResult extends Record<string, unknown> = Record<string, unknown>>(
  event: LedgerEvent,
): CommandReceipt<TResult> {
  const receipt = event.command_receipt;
  if (!receipt) throw new Error(`committed event is missing its durable receipt: ${event.id}`);
  return structuredClone(receipt) as unknown as CommandReceipt<TResult>;
}

export async function commitTutorAction(topicDir: string, input: TutorCommandInput): Promise<CommandReceipt<TutorCommandResult>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.request_id)) throw new Error("invalid request_id");
  const topicPath = resolve(topicDir);
  const topic = topicSlug(topicPath);
  const hash = requestHash(input);
  const eventId = `tutor-${createHash("sha256").update(`${topic}\0${input.request_id}`).digest("hex").slice(0, 32)}`;
  const committed = await transactLedger(join(topicPath, "ledger", "events.jsonl"), (events) => {
    const existing = events.find((event) => event.client_request_id === input.request_id);
    if (existing) {
      if (existing.type !== "tutor.action" || existing.client_request_hash !== hash) {
        throw new Error(`request_id already used with different command or payload: ${input.request_id}`);
      }
      return {
        value: {
          receipt: receiptFromEvent<TutorCommandResult>(existing),
          updated: projectEvents([...events], { asOf: input.occurred_at }),
        },
      };
    }
    const state = projectEvents([...events], { asOf: input.occurred_at });
    const decision = selectTutorAction(state);
    const result: TutorCommandResult = { decision, context: tutorContext(state, decision), action_event_id: eventId };
    const receipt: CommandReceipt<TutorCommandResult> = {
      schema_version: 1,
      request_id: input.request_id,
      command: "tutor.next",
      status: "committed",
      committed_at: input.occurred_at,
      result,
    };
    const event: LedgerEvent = {
      schema_version: 1,
      id: eventId,
      topic,
      type: "tutor.action",
      occurred_at: input.occurred_at,
      data: decision as unknown as Record<string, unknown>,
      client_request_id: input.request_id,
      client_request_hash: hash,
      command_receipt: receipt as unknown as Record<string, unknown>,
    };
    return { event, value: { receipt, updated: projectEvents([...events, event], { asOf: input.occurred_at }) } };
  });
  writeProjections(topicPath, committed.updated);
  return committed.receipt;
}

export async function commitLedgerEvent(
  topicDir: string,
  command: string,
  requestId: string,
  candidate: LedgerEvent,
): Promise<CommandReceipt<LedgerCommandResult>> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(requestId)) throw new Error("invalid request_id");
  const topicPath = resolve(topicDir);
  const topic = topicSlug(topicPath);
  if (candidate.topic !== topic) throw new Error(`ledger command topic mismatch: ${candidate.topic} and ${topic}`);
  const hash = createHash("sha256").update(JSON.stringify(stableValue({
    command,
    event: { topic: candidate.topic, type: candidate.type, occurred_at: candidate.occurred_at, data: candidate.data },
  }))).digest("hex");
  const eventId = `request-${createHash("sha256").update(`${topic}\0${requestId}`).digest("hex").slice(0, 32)}`;
  return transactLedger(join(topicPath, "ledger", "events.jsonl"), (events) => {
    const existing = events.find((event) => event.client_request_id === requestId);
    if (existing) {
      if (existing.client_request_hash !== hash) throw new Error(`request_id already used with different command or payload: ${requestId}`);
      return { value: receiptFromEvent<LedgerCommandResult>(existing) };
    }
    const event: LedgerEvent = {
      ...candidate,
      id: eventId,
      client_request_id: requestId,
      client_request_hash: hash,
    };
    const resultEvent = structuredClone(event);
    const result: LedgerCommandResult = { event_id: eventId, event: resultEvent };
    const receipt: CommandReceipt<LedgerCommandResult> = {
      schema_version: 1,
      request_id: requestId,
      command,
      status: "committed",
      committed_at: candidate.occurred_at,
      result,
    };
    event.command_receipt = receipt as unknown as Record<string, unknown>;
    return { event, value: receipt };
  });
}

export function readCommandReceipt(topicDir: string, requestId: string): CommandReceipt | null {
  const studyReceipt = readStudyReceipt(topicDir, requestId);
  if (studyReceipt) return studyReceipt;
  const event = readLedger(join(resolve(topicDir), "ledger", "events.jsonl")).events.find((candidate) => candidate.client_request_id === requestId);
  return event ? receiptFromEvent(event) : null;
}
