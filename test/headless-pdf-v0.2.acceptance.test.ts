import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("headless PDF-ready core v0.2 acceptance", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("runs the complete restart-safe PDF study, evidence, review, and export workflow", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-pdf-v02-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const fixture = join(import.meta.dir, "fixtures", "headless-study.pdf");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (exit !== 0) throw new Error(`command failed (${args.join(" ")}): ${stderr}`);
      return JSON.parse(stdout) as Record<string, any>;
    };

    expect(readFileSync(fixture, "utf8").startsWith("%PDF-1.4")).toBe(true);
    expect((await run("doctor")).checks.storage).toBe(true);
    await run("init", workspace);
    await run("topic", "init", workspace, "pdf-study", "--title", "PDF Study", "--source", fixture);
    const topic = join(workspace, "topics", "pdf-study");
    const ownedPdf = join(topic, "sources", "headless-study.pdf");

    expect((await run("workspace", "list", workspace)).workspaces[0].topic_count).toBe(1);
    expect((await run("topic", "list", workspace)).topics[0].slug).toBe("pdf-study");
    expect((await run("topic", "open", topic)).active_document).toBeNull();

    const registerArgs = [
      "pdf", "register", topic, "--request-id", "pdf-register", "--document", "headless-v1",
      "--relative-path", "sources/headless-study.pdf", "--pages", "3", "--at", "2026-03-01T00:00:00Z",
    ];
    const registration = await run(...registerArgs);
    expect(await run(...registerArgs)).toEqual(registration);
    expect(await run("receipt", "get", topic, "--request-id", "pdf-register")).toEqual(registration);
    const document = registration.result.document as { document_id: string; sha256: string };

    const concept = await run(
      "record", "concept", topic, "--request-id", "concept-request", "--concept", "append",
      "--title", "Append-only history", "--source-ref", "sources/headless-study.pdf", "--at", "2026-03-01T00:01:00Z",
    );
    const questionOne = await run(
      "record", "question", topic, "--request-id", "question-one", "--question", "q1", "--concept", "append",
      "--prompt", "How are corrections represented?", "--source-ref", "sources/headless-study.pdf", "--at", "2026-03-01T00:02:00Z",
    );
    expect(await run("receipt", "get", topic, "--request-id", "concept-request")).toEqual(concept);
    const introduced = await run("projection", "get", topic, "--as-of", "2026-03-01T00:03:00Z");
    expect(introduced.projection.concepts[0].status).toBe("introduced");
    const ledgerBeforeStudy = readFileSync(join(topic, "ledger", "events.jsonl"), "utf8");

    await run("study", "progress", "set", topic, "--request-id", "progress-1", "--chapter", "chapter-1", "--page", "1", "--position", "0.8", "--completed", "true", "--at", "2026-03-01T00:03:00Z");
    await run("study", "progress", "set", topic, "--request-id", "progress-3", "--chapter", "chapter-3", "--page", "3", "--position", "0.2", "--completed", "false", "--at", "2026-03-01T00:04:00Z");

    const textAnchor = {
      document_id: document.document_id, document_sha256: document.sha256, physical_page: 1, display_label: "1",
      kind: "text", selected_text: "Corrections append new records and preserve history.",
      normalized_region: { x: 0.1, y: 0.1, width: 0.75, height: 0.08 }, status: "exact",
    };
    const regionAnchor = {
      document_id: document.document_id, document_sha256: document.sha256, physical_page: 2, display_label: "ii",
      kind: "region", normalized_region: { x: 0.2, y: 0.2, width: 0.5, height: 0.2 }, status: "ambiguous",
    };
    const pageAnchor = {
      document_id: document.document_id, document_sha256: document.sha256, physical_page: 3,
      kind: "page", status: "unavailable",
    };
    const anchorJson = (anchor: object) => JSON.stringify(anchor);

    await run("study", "highlight", "add", topic, "--request-id", "highlight-only", "--highlight", "h-only", "--anchor-json", anchorJson(textAnchor), "--at", "2026-03-01T00:05:00Z");
    await run("study", "comment", "add", topic, "--request-id", "comment-text", "--comment", "c-text", "--text", "Text-only comment", "--anchor-json", anchorJson(textAnchor), "--at", "2026-03-01T00:06:00Z");
    await run("study", "comment", "add", topic, "--request-id", "comment-region", "--comment", "c-region", "--text", "Region-only comment", "--anchor-json", anchorJson(regionAnchor), "--at", "2026-03-01T00:07:00Z");
    await run(
      "study", "comment", "add", topic, "--request-id", "comment-page", "--comment", "c-page",
      "--text", "I may be confusing atomicity with durability.", "--anchor-json", anchorJson(pageAnchor),
      "--candidate-json", JSON.stringify({ candidate_id: "candidate-confusion", kind: "misconception", concept_id: "append" }),
      "--at", "2026-03-01T00:08:00Z",
    );

    await run("study", "highlight", "add", topic, "--request-id", "pair-a-h", "--highlight", "h-pair-a", "--anchor-json", anchorJson(textAnchor), "--at", "2026-03-01T00:09:00Z");
    await run("study", "comment", "add", topic, "--request-id", "pair-a-c", "--comment", "c-pair-a", "--text", "Shared A", "--anchor-json", anchorJson(textAnchor), "--at", "2026-03-01T00:10:00Z");
    await run("study", "highlight", "delete", topic, "--request-id", "pair-a-delete", "--highlight", "h-pair-a", "--at", "2026-03-01T00:11:00Z");
    await run("study", "highlight", "add", topic, "--request-id", "pair-b-h", "--highlight", "h-pair-b", "--anchor-json", anchorJson(regionAnchor), "--at", "2026-03-01T00:12:00Z");
    await run("study", "comment", "add", topic, "--request-id", "pair-b-c", "--comment", "c-pair-b", "--text", "Shared B", "--anchor-json", anchorJson(regionAnchor), "--at", "2026-03-01T00:13:00Z");
    await run("study", "comment", "delete", topic, "--request-id", "pair-b-delete", "--comment", "c-pair-b", "--at", "2026-03-01T00:14:00Z");
    await run("study", "conversation", "add", topic, "--request-id", "turn-1", "--turn", "turn-1", "--speaker", "learner", "--text", "Why does append preserve history?", "--anchor-json", anchorJson(textAnchor), "--at", "2026-03-01T00:15:00Z");

    const resumed = await run("topic", "resume", topic);
    expect(resumed.resume).toEqual({ chapter_id: "chapter-3", physical_page: 3, position: 0.2 });
    expect(resumed.study.progress.map((item: { chapter_id: string }) => item.chapter_id)).toEqual(["chapter-1", "chapter-3"]);
    expect(resumed.study.highlights.map((item: { highlight_id: string }) => item.highlight_id)).toEqual(["h-only", "h-pair-b"]);
    expect(resumed.study.comments.map((item: { comment_id: string }) => item.comment_id)).toEqual(["c-page", "c-pair-a", "c-region", "c-text"]);
    expect(resumed.study.candidates[0]).toMatchObject({ candidate_id: "candidate-confusion", comment_id: "c-page", anchor: pageAnchor });
    expect(readFileSync(join(topic, "ledger", "events.jsonl"), "utf8")).toBe(ledgerBeforeStudy);
    expect((await run("projection", "get", topic, "--as-of", "2026-03-01T00:16:00Z")).projection.concepts[0].status).toBe("introduced");

    const excerpt = JSON.stringify({ excerpt_id: "source-1", text: "Corrections append new records and preserve history.", anchor: textAnchor });
    const contextArgs = ["context", "build", topic, "--question", "Why append?", "--source-excerpt-json", excerpt, "--as-of", "2026-03-01T00:16:00Z", "--max-items", "6", "--max-chars", "320"];
    const context = await run(...contextArgs);
    expect(await run(...contextArgs)).toEqual(context);
    expect(context.items.map((item: { role: string }) => item.role)).toEqual(["source_excerpt", "learner_comment", "reading_progress", "prior_conversation", "ledger_evidence", "projection_state"]);
    expect(context.text_chars).toBeLessThanOrEqual(320);

    const policy = await run("next", topic, "--request-id", "policy-1", "--at", "2026-03-01T00:17:00Z");
    expect(policy.result.decision).toMatchObject({ action: "elicit_attempt", reason_codes: ["evidence_before_explanation", "single_bottleneck"] });
    expect(await run("next", topic, "--request-id", "policy-1", "--at", "2026-03-01T00:17:00Z")).toEqual(policy);

    const attemptOne = await run(
      "record", "attempt", topic, "--request-id", "attempt-one", "--question", "q1", "--concept", "append",
      "--answer", "A new event", "--correct", "true", "--assistance", "none", "--at", "2026-03-01T00:18:00Z",
    );
    await run(
      "record", "question", topic, "--request-id", "question-two", "--question", "q2", "--concept", "append",
      "--prompt", "What prevents a mixed projection?", "--source-ref", "sources/headless-study.pdf", "--at", "2026-03-01T00:19:00Z",
    );
    const attemptTwo = await run(
      "record", "attempt", topic, "--request-id", "attempt-two", "--question", "q2", "--concept", "append",
      "--answer", "Atomic publication", "--correct", "true", "--assistance", "none", "--at", "2026-03-01T00:20:00Z",
    );
    const stable = await run("projection", "get", topic, "--as-of", "2026-03-01T00:21:00Z");
    const evidenceIds = [attemptOne.result.event_id, attemptTwo.result.event_id];
    expect(stable.projection.concepts[0].status).toBe("stable");
    expect(stable.projection.concepts[0].state_history.at(-1).evidence_event_ids).toEqual(evidenceIds);
    expect(stable.projection.concepts[0].evidence_event_ids.some((id: string) => id.startsWith("study-"))).toBe(false);

    const reviewDecision = await run("next", topic, "--request-id", "review-decision", "--at", "2026-03-01T00:21:00Z");
    expect(reviewDecision.result.decision.action).toBe("schedule_review");
    const review = reviewDecision.result.decision;
    await run(
      "schedule-review", topic, "--request-id", "review-schedule", "--concept", review.concept_id,
      "--due", review.due_at, ...review.evidence_event_ids.flatMap((id: string) => ["--reason-event", id]),
      "--at", "2026-03-01T00:22:00Z",
    );

    rmSync(join(topic, "projections"), { recursive: true, force: true });
    await run("project", topic, "--as-of", "2026-03-02T00:00:00Z");
    expect((await run("topic", "resume", topic)).study.comments).toHaveLength(4);
    expect((await run("projection", "get", topic, "--as-of", "2026-03-02T00:00:00Z")).projection.concepts[0].status).toBe("stable");

    const due = await run("next", topic, "--request-id", "due-review", "--at", review.due_at);
    expect(due.result.decision.action).toBe("ask_due_review");
    const reviewAttempt = await run(
      "record", "attempt", topic, "--request-id", "review-attempt", "--question", due.result.decision.question_id,
      "--concept", "append", "--answer", "A correction is another event", "--correct", "true", "--assistance", "none",
      "--at", "2026-03-04T00:22:00Z",
    );
    const afterReview = await run("projection", "get", topic, "--as-of", "2026-03-05T00:00:00Z");
    expect(afterReview.projection.review_history[0].status).toBe("completed");

    const exported = await run("export-gbrain", topic, "--as-of", "2026-03-05T00:00:00Z");
    expect(exported).toMatchObject({ candidate_count: 1, mutates_knowledge_base: false });
    const candidateFile = JSON.parse(readFileSync(exported.output, "utf8"));
    expect(candidateFile.mutates_knowledge_base).toBe(false);
    expect(candidateFile.candidates[0].qualifying_evidence_event_ids).toEqual([attemptTwo.result.event_id, reviewAttempt.result.event_id]);
    expect(existsSync(join(workspace, ".gbrain"))).toBe(false);

    writeFileSync(ownedPdf, Buffer.concat([readFileSync(ownedPdf), Buffer.from("\nchanged\n")]));
    const changed = await run("topic", "open", topic);
    expect(changed.active_document).toMatchObject({ document_id: "headless-v1", sha256: document.sha256, status: "changed" });
    expect(changed.study.comments.find((item: { comment_id: string }) => item.comment_id === "c-text").anchor.document_sha256).toBe(document.sha256);
    expect(questionOne.result.event_id).toBeString();
  }, 30_000);
});
