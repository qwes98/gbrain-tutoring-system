import appContractSchema from "../schemas/app-contract.v1.schema.json";
import { validateJsonSchema } from "./json-schema.ts";
import type { TopicProjection } from "./projection.ts";
import type { ValidationResult } from "./types.ts";

export interface WorkspaceSummary {
  path: string;
  name: string;
  topic_count: number;
}

export interface WorkspaceList {
  schema_version: 1;
  workspaces: WorkspaceSummary[];
}

export interface TopicSummary {
  path: string;
  slug: string;
  title: string;
  sources: string[];
}

export interface TopicList {
  schema_version: 1;
  workspace: string;
  topics: TopicSummary[];
}

export interface DocumentIdentity {
  document_id: string;
  relative_path: string;
  sha256: string;
  byte_length: number;
  page_count: number;
  status: "exact" | "changed" | "unavailable";
}

export interface ReadingResume {
  chapter_id: string;
  physical_page: number;
  position: number;
}

export type AnchorStatus = "exact" | "ambiguous" | "unavailable";
export type AnchorKind = "text" | "region" | "page";
export interface NormalizedRegion { x: number; y: number; width: number; height: number; }
export interface SourceAnchor {
  document_id: string;
  document_sha256: string;
  physical_page: number;
  display_label?: string;
  kind: AnchorKind;
  selected_text?: string;
  normalized_region?: NormalizedRegion;
  status: AnchorStatus;
}
export interface StudyProgress extends ReadingResume { completed: boolean; updated_at: string; }
export interface Highlight { highlight_id: string; anchor: SourceAnchor; created_at: string; }
export interface Comment { comment_id: string; text: string; anchor: SourceAnchor; created_at: string; }
export interface StudyCandidate {
  candidate_id: string;
  kind: "question" | "misconception";
  concept_id?: string;
  comment_id: string;
  anchor: SourceAnchor;
  status: "open";
  created_at: string;
}
export interface ConversationTurn {
  turn_id: string;
  speaker: "learner" | "tutor";
  text: string;
  anchor?: SourceAnchor;
  created_at: string;
}

export interface StudySnapshot {
  progress_count: number;
  highlight_count: number;
  comment_count: number;
  candidate_count: number;
  progress: StudyProgress[];
  highlights: Highlight[];
  comments: Comment[];
  candidates: StudyCandidate[];
  conversation: ConversationTurn[];
}

export interface TopicSnapshot {
  schema_version: 1;
  topic: TopicSummary;
  active_document: DocumentIdentity | null;
  resume: ReadingResume | null;
  study: StudySnapshot;
}

export interface ProjectionSnapshot {
  schema_version: 1;
  topic: string;
  as_of: string;
  projection: TopicProjection;
}

export type TutorAction = "elicit_attempt" | "give_hint" | "explain_bottleneck" | "ask_due_review" | "schedule_review" | "complete";

export interface TutorDecision {
  action: TutorAction;
  concept_id?: string;
  question_id?: string;
  due_at?: string;
  reason_codes: string[];
  evidence_event_ids: string[];
}

export interface CommandReceipt<TResult extends Record<string, unknown> = Record<string, unknown>> {
  schema_version: 1;
  request_id: string;
  command: string;
  status: "committed";
  committed_at: string;
  result: TResult;
}

export type AppContractName = "workspace_list" | "topic_list" | "topic_snapshot" | "projection_snapshot" | "tutor_decision" | "command_receipt";

export function validateAppContract(name: AppContractName, value: unknown): ValidationResult {
  const schema = {
    $defs: appContractSchema.$defs,
    allOf: [{ $ref: `#/$defs/${name}` }],
  } as Record<string, unknown>;
  const errors = validateJsonSchema(value, schema);
  return { valid: errors.length === 0, errors };
}
