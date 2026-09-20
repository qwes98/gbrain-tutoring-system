import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openAnchoredDirectory } from "./anchored-fs.ts";
import type {
  AnchorKind,
  AnchorStatus,
  CommandReceipt,
  Comment,
  ConversationTurn,
  DocumentIdentity,
  Highlight,
  NormalizedRegion,
  ReadingResume,
  SourceAnchor,
  StudyCandidate,
  StudyProgress,
} from "./contracts.ts";
import { readAppendOnlyJsonl, transactAppendOnlyJsonl } from "./ledger.ts";

export type { AnchorKind, AnchorStatus, Comment, ConversationTurn, Highlight, NormalizedRegion, SourceAnchor, StudyCandidate, StudyProgress } from "./contracts.ts";

export interface StudyState {
  schema_version: 1;
  topic: string;
  active_document: DocumentIdentity | null;
  resume: ReadingResume | null;
  progress: StudyProgress[];
  highlights: Highlight[];
  comments: Comment[];
  candidates: StudyCandidate[];
  conversation: ConversationTurn[];
}

type StudyEventType = "pdf.registered" | "progress.updated" | "highlight.added" | "highlight.deleted" | "comment.added" | "comment.deleted" | "conversation.added";

interface StudyEvent {
  schema_version: 1;
  id: string;
  request_id: string;
  payload_hash: string;
  topic: string;
  type: StudyEventType;
  occurred_at: string;
  data: Record<string, unknown>;
  receipt: CommandReceipt;
}

interface MutationBase { request_id: string; occurred_at: string; }
interface RegisterPdfInput extends MutationBase { document_id: string; relative_path: string; page_count: number; }
interface ProgressInput extends MutationBase { chapter_id: string; physical_page: number; position: number; completed: boolean; }
interface HighlightInput extends MutationBase { highlight_id: string; anchor: SourceAnchor; }
interface DeleteHighlightInput extends MutationBase { highlight_id: string; }
interface CommentInput extends MutationBase {
  comment_id: string;
  text: string;
  anchor: SourceAnchor;
  candidate?: { candidate_id: string; kind: "question" | "misconception"; concept_id?: string };
}
interface DeleteCommentInput extends MutationBase { comment_id: string; }
export interface ConversationInput extends MutationBase { turn_id: string; speaker: "learner" | "tutor"; text: string; anchor?: SourceAnchor; }

function journalPath(topicDir: string): string {
  return join(resolve(topicDir), "study", "events.jsonl");
}

function topicSlug(topicDir: string): string {
  const root = openAnchoredDirectory(resolve(topicDir));
  try {
    const descriptor = openSync(root.child("topic.json"), constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return (JSON.parse(readFileSync(descriptor, "utf8")) as { slug: string }).slug; }
    finally { closeSync(descriptor); }
  } finally { root.close(); }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]));
}

function payloadHash(command: string, input: object): string {
  return createHash("sha256").update(JSON.stringify(stableValue({ command, input }))).digest("hex");
}

function parseStudyEvent(value: unknown): StudyEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("study event must be an object");
  const event = value as Partial<StudyEvent>;
  if (event.schema_version !== 1 || typeof event.id !== "string" || typeof event.request_id !== "string"
    || typeof event.payload_hash !== "string" || typeof event.topic !== "string" || typeof event.type !== "string"
    || typeof event.occurred_at !== "string" || !event.data || typeof event.data !== "object"
    || !event.receipt || typeof event.receipt !== "object") throw new Error("invalid study event");
  return event as StudyEvent;
}

function emptyStudyState(topic: string): StudyState {
  return { schema_version: 1, topic, active_document: null, resume: null, progress: [], highlights: [], comments: [], candidates: [], conversation: [] };
}

function assertRegion(region: NormalizedRegion): void {
  for (const [name, value] of Object.entries(region)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`anchor region ${name} must be between 0 and 1`);
  }
  if (region.width <= 0 || region.height <= 0 || region.x + region.width > 1 || region.y + region.height > 1) {
    throw new Error("anchor region must have positive dimensions within the page");
  }
}

export function assertSourceAnchor(anchor: SourceAnchor): void {
  if (!anchor.document_id || !/^[0-9a-f]{64}$/.test(anchor.document_sha256)) throw new Error("anchor requires document identity and sha256");
  if (!Number.isInteger(anchor.physical_page) || anchor.physical_page < 1) throw new Error("anchor physical_page must be positive");
  if (!["text", "region", "page"].includes(anchor.kind) || !["exact", "ambiguous", "unavailable"].includes(anchor.status)) throw new Error("invalid anchor kind or status");
  if (anchor.kind === "text" && !anchor.selected_text) throw new Error("text anchor requires selected_text");
  if (anchor.kind === "region" && !anchor.normalized_region) throw new Error("region anchor requires normalized_region");
  if (anchor.kind === "page" && (anchor.selected_text !== undefined || anchor.normalized_region !== undefined)) throw new Error("page anchor cannot include text or region");
  if (anchor.normalized_region) assertRegion(anchor.normalized_region);
}

function reduceStudyEvents(events: readonly StudyEvent[], topic: string): StudyState {
  const state = emptyStudyState(topic);
  for (const event of events) {
    if (event.topic !== topic) throw new Error(`mixed topics in study journal: ${topic} and ${event.topic}`);
    const data = event.data;
    if (event.type === "pdf.registered") state.active_document = structuredClone(data.document as DocumentIdentity);
    else if (event.type === "progress.updated") {
      const progress = structuredClone(data.progress as StudyProgress);
      state.progress = [...state.progress.filter((item) => item.chapter_id !== progress.chapter_id), progress]
        .sort((left, right) => left.chapter_id.localeCompare(right.chapter_id));
      state.resume = { chapter_id: progress.chapter_id, physical_page: progress.physical_page, position: progress.position };
    } else if (event.type === "highlight.added") {
      const highlight = structuredClone(data.highlight as Highlight);
      if (state.highlights.some((item) => item.highlight_id === highlight.highlight_id)) throw new Error(`highlight already exists: ${highlight.highlight_id}`);
      state.highlights.push(highlight);
      state.highlights.sort((left, right) => left.highlight_id.localeCompare(right.highlight_id));
    } else if (event.type === "highlight.deleted") {
      const id = data.highlight_id as string;
      if (!state.highlights.some((item) => item.highlight_id === id)) throw new Error(`highlight not found: ${id}`);
      state.highlights = state.highlights.filter((item) => item.highlight_id !== id);
    } else if (event.type === "comment.added") {
      const comment = structuredClone(data.comment as Comment);
      if (state.comments.some((item) => item.comment_id === comment.comment_id)) throw new Error(`comment already exists: ${comment.comment_id}`);
      state.comments.push(comment);
      state.comments.sort((left, right) => left.comment_id.localeCompare(right.comment_id));
      if (data.candidate) {
        const candidate = structuredClone(data.candidate as StudyCandidate);
        if (state.candidates.some((item) => item.candidate_id === candidate.candidate_id)) throw new Error(`candidate already exists: ${candidate.candidate_id}`);
        state.candidates.push(candidate);
        state.candidates.sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
      }
    } else if (event.type === "comment.deleted") {
      const id = data.comment_id as string;
      if (!state.comments.some((item) => item.comment_id === id)) throw new Error(`comment not found: ${id}`);
      state.comments = state.comments.filter((item) => item.comment_id !== id);
    } else if (event.type === "conversation.added") {
      const turn = structuredClone(data.turn as ConversationTurn);
      if (state.conversation.some((item) => item.turn_id === turn.turn_id)) throw new Error(`conversation turn already exists: ${turn.turn_id}`);
      state.conversation.push(turn);
    }
  }
  return state;
}

function readDocument(topicDir: string, relativePath: string): Omit<DocumentIdentity, "document_id" | "page_count" | "status"> {
  const match = /^sources\/([^/]+)$/.exec(relativePath);
  if (!match) throw new Error("PDF relative_path must name one file under sources/");
  const topic = openAnchoredDirectory(resolve(topicDir));
  let sources = null as ReturnType<typeof openAnchoredDirectory> | null;
  try {
    sources = topic.openDirectory("sources");
    const descriptor = openSync(sources.child(match[1]!), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(descriptor);
      if (!stat.isFile()) throw new Error("PDF source is not a regular file");
      const bytes = readFileSync(descriptor);
      return { relative_path: relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), byte_length: bytes.length };
    } finally { closeSync(descriptor); }
  } finally {
    sources?.close();
    topic.close();
  }
}

async function mutateStudy(
  topicDir: string,
  command: string,
  input: MutationBase & Record<string, unknown>,
  type: StudyEventType,
  dataFactory: (state: StudyState) => Record<string, unknown>,
): Promise<CommandReceipt> {
  if (!input.request_id) throw new Error("request_id is required");
  const topic = topicSlug(topicDir);
  const hash = payloadHash(command, input);
  return transactAppendOnlyJsonl(
    journalPath(topicDir),
    parseStudyEvent,
    (events, event) => { reduceStudyEvents([...events, event], topic); },
    (events) => {
      const existing = events.find((event) => event.request_id === input.request_id);
      if (existing) {
        if (existing.payload_hash !== hash || existing.receipt.command !== command) throw new Error(`request_id already used with different command or payload: ${input.request_id}`);
        return { value: existing.receipt };
      }
      const data = dataFactory(reduceStudyEvents(events, topic));
      const result = { event_id: `study-${input.request_id}`, ...data };
      const receipt: CommandReceipt = { schema_version: 1, request_id: input.request_id, command, status: "committed", committed_at: input.occurred_at, result };
      const event: StudyEvent = { schema_version: 1, id: `study-${input.request_id}`, request_id: input.request_id, payload_hash: hash, topic, type, occurred_at: input.occurred_at, data, receipt };
      return { record: event, value: receipt };
    },
  );
}

export async function registerPdf(topicDir: string, input: RegisterPdfInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "pdf.register", input as RegisterPdfInput & Record<string, unknown>, "pdf.registered", () => {
    if (!input.document_id || !Number.isInteger(input.page_count) || input.page_count < 1) throw new Error("PDF registration requires document_id and positive page_count");
    const observed = readDocument(topicDir, input.relative_path);
    const document: DocumentIdentity = { document_id: input.document_id, ...observed, page_count: input.page_count, status: "exact" };
    return { document };
  });
}

export async function setReadingProgress(topicDir: string, input: ProgressInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "progress.set", input as ProgressInput & Record<string, unknown>, "progress.updated", () => {
    if (!input.chapter_id || !Number.isInteger(input.physical_page) || input.physical_page < 1 || input.position < 0 || input.position > 1) throw new Error("invalid reading progress");
    const progress: StudyProgress = { chapter_id: input.chapter_id, physical_page: input.physical_page, position: input.position, completed: input.completed, updated_at: input.occurred_at };
    return { progress };
  });
}

export async function addHighlight(topicDir: string, input: HighlightInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "highlight.add", input as HighlightInput & Record<string, unknown>, "highlight.added", (state) => {
    assertSourceAnchor(input.anchor);
    if (!state.active_document || input.anchor.document_id !== state.active_document.document_id || input.anchor.document_sha256 !== state.active_document.sha256) throw new Error("anchor document identity does not match the registered PDF");
    return { highlight: { highlight_id: input.highlight_id, anchor: input.anchor, created_at: input.occurred_at } satisfies Highlight };
  });
}

export async function deleteHighlight(topicDir: string, input: DeleteHighlightInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "highlight.delete", input as DeleteHighlightInput & Record<string, unknown>, "highlight.deleted", () => ({ highlight_id: input.highlight_id }));
}

export async function addComment(topicDir: string, input: CommentInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "comment.add", input as CommentInput & Record<string, unknown>, "comment.added", (state) => {
    assertSourceAnchor(input.anchor);
    if (!input.text) throw new Error("comment text is required");
    if (!state.active_document || input.anchor.document_id !== state.active_document.document_id || input.anchor.document_sha256 !== state.active_document.sha256) throw new Error("anchor document identity does not match the registered PDF");
    const comment: Comment = { comment_id: input.comment_id, text: input.text, anchor: input.anchor, created_at: input.occurred_at };
    const candidate = input.candidate ? {
      ...input.candidate,
      comment_id: input.comment_id,
      anchor: input.anchor,
      status: "open" as const,
      created_at: input.occurred_at,
    } : undefined;
    return { comment, ...(candidate ? { candidate } : {}) };
  });
}

export async function deleteComment(topicDir: string, input: DeleteCommentInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "comment.delete", input as DeleteCommentInput & Record<string, unknown>, "comment.deleted", () => ({ comment_id: input.comment_id }));
}

export async function addConversationTurn(topicDir: string, input: ConversationInput): Promise<CommandReceipt> {
  return mutateStudy(topicDir, "conversation.add", input as ConversationInput & Record<string, unknown>, "conversation.added", (state) => {
    if (!input.text) throw new Error("conversation text is required");
    if (input.anchor) {
      assertSourceAnchor(input.anchor);
      if (!state.active_document || input.anchor.document_id !== state.active_document.document_id || input.anchor.document_sha256 !== state.active_document.sha256) throw new Error("anchor document identity does not match the registered PDF");
    }
    return { turn: { turn_id: input.turn_id, speaker: input.speaker, text: input.text, ...(input.anchor ? { anchor: input.anchor } : {}), created_at: input.occurred_at } satisfies ConversationTurn };
  });
}

export function readStudyState(topicDir: string): StudyState {
  const topic = topicSlug(topicDir);
  return reduceStudyEvents(readAppendOnlyJsonl(journalPath(topicDir), parseStudyEvent), topic);
}

export function inspectActiveDocument(topicDir: string, document: DocumentIdentity | null): DocumentIdentity | null {
  if (!document) return null;
  try {
    const observed = readDocument(topicDir, document.relative_path);
    return { ...document, status: observed.sha256 === document.sha256 && observed.byte_length === document.byte_length ? "exact" : "changed" };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { ...document, status: "unavailable" };
    throw error;
  }
}

export function readStudyReceipt(topicDir: string, requestId: string): CommandReceipt | null {
  return readAppendOnlyJsonl(journalPath(topicDir), parseStudyEvent).find((event) => event.request_id === requestId)?.receipt ?? null;
}
