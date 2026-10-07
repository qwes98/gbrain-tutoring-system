import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openTopic } from "../src/app-query.ts";
import { readLedger } from "../src/ledger.ts";
import { projectEvents } from "../src/projection.ts";
import {
  addComment,
  addHighlight,
  deleteComment,
  deleteHighlight,
  readStudyReceipt,
  readStudyState,
  registerPdf,
  setReadingProgress,
  type SourceAnchor,
} from "../src/study-state.ts";
import { createProject, createTopic } from "../src/workspace.ts";

describe("durable PDF study-state plane", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("keeps PDF identity, progress, annotations, and comment candidates independent from mastery", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-study-state-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "manual.pdf");
    writeFileSync(source, "%PDF-1.4\nchapter one\n");
    createProject(workspace);
    const topic = createTopic(workspace, { slug: "manual", title: "Manual", source });
    const ledger = join(topic, "ledger", "events.jsonl");
    const at = "2026-02-01T00:00:00Z";

    const registration = await registerPdf(topic, {
      request_id: "register-pdf",
      document_id: "manual-v1",
      relative_path: "sources/manual.pdf",
      page_count: 12,
      occurred_at: at,
    });
    expect(await registerPdf(topic, {
      request_id: "register-pdf",
      document_id: "manual-v1",
      relative_path: "sources/manual.pdf",
      page_count: 12,
      occurred_at: at,
    })).toEqual(registration);
    expect(readStudyReceipt(topic, "register-pdf")).toEqual(registration);

    const document = readStudyState(topic).active_document!;
    const textAnchor: SourceAnchor = {
      document_id: document.document_id,
      document_sha256: document.sha256,
      physical_page: 2,
      display_label: "3",
      kind: "text",
      selected_text: "A durable event is appended.",
      normalized_region: { x: 0.1, y: 0.2, width: 0.6, height: 0.08 },
      status: "exact",
    };
    const regionAnchor: SourceAnchor = {
      document_id: document.document_id,
      document_sha256: document.sha256,
      physical_page: 3,
      kind: "region",
      normalized_region: { x: 0.2, y: 0.25, width: 0.5, height: 0.2 },
      status: "ambiguous",
    };
    const pageAnchor: SourceAnchor = {
      document_id: document.document_id,
      document_sha256: document.sha256,
      physical_page: 4,
      kind: "page",
      status: "unavailable",
    };

    await setReadingProgress(topic, { request_id: "progress", chapter_id: "chapter-1", physical_page: 2, position: 0.4, completed: false, occurred_at: "2026-02-01T00:01:00Z" });
    await addHighlight(topic, { request_id: "highlight-only", highlight_id: "h-only", anchor: textAnchor, occurred_at: "2026-02-01T00:02:00Z" });
    await addComment(topic, { request_id: "comment-text", comment_id: "c-text", text: "Text note", anchor: textAnchor, occurred_at: "2026-02-01T00:03:00Z" });
    await addComment(topic, { request_id: "comment-region", comment_id: "c-region", text: "Region note", anchor: regionAnchor, occurred_at: "2026-02-01T00:04:00Z" });
    await addComment(topic, { request_id: "comment-page", comment_id: "c-page", text: "I may be confusing durability with ordering.", anchor: pageAnchor, candidate: { candidate_id: "candidate-1", kind: "misconception", concept_id: "durability" }, occurred_at: "2026-02-01T00:05:00Z" });

    await addHighlight(topic, { request_id: "shared-h-add", highlight_id: "h-shared", anchor: textAnchor, occurred_at: "2026-02-01T00:06:00Z" });
    await addComment(topic, { request_id: "shared-c-add", comment_id: "c-shared", text: "Shared anchor", anchor: textAnchor, occurred_at: "2026-02-01T00:07:00Z" });
    await deleteHighlight(topic, { request_id: "shared-h-delete", highlight_id: "h-shared", occurred_at: "2026-02-01T00:08:00Z" });

    await addHighlight(topic, { request_id: "reverse-h-add", highlight_id: "h-reverse", anchor: regionAnchor, occurred_at: "2026-02-01T00:09:00Z" });
    await addComment(topic, { request_id: "reverse-c-add", comment_id: "c-reverse", text: "Reverse shared anchor", anchor: regionAnchor, occurred_at: "2026-02-01T00:10:00Z" });
    await deleteComment(topic, { request_id: "reverse-c-delete", comment_id: "c-reverse", occurred_at: "2026-02-01T00:11:00Z" });

    const state = readStudyState(topic);
    expect(state.resume).toEqual({ chapter_id: "chapter-1", physical_page: 2, position: 0.4 });
    expect(state.highlights.map((item) => item.highlight_id)).toEqual(["h-only", "h-reverse"]);
    expect(state.comments.map((item) => item.comment_id)).toEqual(["c-page", "c-region", "c-shared", "c-text"]);
    expect(state.candidates).toEqual([expect.objectContaining({ candidate_id: "candidate-1", comment_id: "c-page", anchor: pageAnchor })]);
    expect(openTopic(topic).study).toMatchObject({
      highlight_count: 2,
      comment_count: 4,
      highlights: state.highlights,
      comments: state.comments,
      candidates: state.candidates,
    });
    expect(readLedger(ledger).events).toHaveLength(0);
    expect(projectEvents([], { asOf: "2026-02-02T00:00:00Z" }).concepts).toEqual([]);

    writeFileSync(join(topic, "sources", "manual.pdf"), "%PDF-1.4\nchanged bytes\n");
    expect(openTopic(topic).active_document?.status).toBe("changed");
    expect(readFileSync(join(topic, "study", "events.jsonl"), "utf8").trim().split("\n").length).toBe(12);
  });
});
