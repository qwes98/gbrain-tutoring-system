export type Assistance = "none" | "hint" | "explanation";
export type LedgerEventType = "concept.declared" | "question.asked" | "attempt.recorded" | "evidence.recorded" | "misconception.observed" | "misconception.resolved" | "review.scheduled" | "tutor.action" | "event.corrected";

export interface LedgerEvent<T = Record<string, unknown>> {
  schema_version: 1;
  id: string;
  topic: string;
  type: LedgerEventType;
  occurred_at: string;
  data: T;
  client_request_id?: string;
  client_request_hash?: string;
  command_receipt?: Record<string, unknown>;
}

export interface ValidationResult { valid: boolean; errors: string[]; }
