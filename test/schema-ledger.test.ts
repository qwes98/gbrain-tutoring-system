import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/ledger.ts";
import { validateEvent } from "../src/schema.ts";

describe("ledger schema and append semantics", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("rejects events that violate the JSON Schema contract", () => {
    const result = validateEvent({
      schema_version: 1,
      id: "event-1",
      topic: "algebra",
      type: "attempt.recorded",
      occurred_at: "not-a-date",
      data: { concept_id: "variables", correct: "yes", assistance: "none" },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("occurred_at");
    expect(result.errors.join(" ")).toContain("correct");
  });

  test("rejects semantically invalid RFC 3339 timestamps", () => {
    const invalidTimestamps = [
      "2026-02-30T12:00:00Z",
      "2026-01-01T24:00:00Z",
    ];

    for (const occurred_at of invalidTimestamps) {
      const result = validateEvent({
        schema_version: 1,
        id: "event-1",
        topic: "algebra",
        type: "evidence.recorded",
        occurred_at,
        data: { concept_id: "variables", kind: "observation", summary: "Observed behavior" },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.join(" ")).toContain("occurred_at");
    }
  });

  test("requires fields appropriate to each tutor action", () => {
    const base = {
      schema_version: 1 as const,
      id: "action-1",
      topic: "algebra",
      type: "tutor.action" as const,
      occurred_at: "2026-01-01T00:00:00Z",
    };
    const common = { reason_codes: ["reason"], evidence_event_ids: [] };
    const invalidActions = [
      { action: "schedule_review", concept_id: "variables", ...common },
      { action: "schedule_review", due_at: "2026-01-04T00:00:00Z", ...common },
      { action: "elicit_attempt", concept_id: "variables", ...common },
      { action: "give_hint", question_id: "q-1", ...common },
      { action: "explain_bottleneck", concept_id: "variables", ...common },
      { action: "ask_due_review", concept_id: "variables", ...common },
    ];

    for (const data of invalidActions) expect(validateEvent({ ...base, data }).valid).toBe(false);

    expect(validateEvent({
      ...base,
      data: { action: "schedule_review", concept_id: "variables", due_at: "2026-01-04T00:00:00Z", ...common },
    }).valid).toBe(true);
    expect(validateEvent({
      ...base,
      data: { action: "give_hint", concept_id: "variables", question_id: "q-1", ...common },
    }).valid).toBe(true);
    expect(validateEvent({ ...base, data: { action: "complete", ...common } }).valid).toBe(true);
  });

  test("rejects fields that are inappropriate for a tutor action", () => {
    const base = {
      schema_version: 1 as const,
      id: "action-extra",
      topic: "algebra",
      type: "tutor.action" as const,
      occurred_at: "2026-01-01T00:00:00Z",
    };
    const common = { reason_codes: ["reason"], evidence_event_ids: [] };

    expect(validateEvent({ ...base, data: { action: "complete", concept_id: "variables", ...common } }).valid).toBe(false);
    expect(validateEvent({ ...base, data: { action: "give_hint", concept_id: "variables", question_id: "q", due_at: "2026-01-04T00:00:00Z", ...common } }).valid).toBe(false);
    expect(validateEvent({ ...base, data: { action: "schedule_review", concept_id: "variables", question_id: "q", due_at: "2026-01-04T00:00:00Z", ...common } }).valid).toBe(false);
  });

  test("appends validated events and rejects duplicate event IDs", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-ledger-"));
    roots.push(root);
    const path = join(root, "ledger", "events.jsonl");
    mkdirSync(join(root, "ledger"), { recursive: true });
    const event = {
      schema_version: 1 as const,
      id: "concept-1",
      topic: "algebra",
      type: "concept.declared" as const,
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { concept_id: "variables", title: "Variables", source_refs: ["sources/book.md#variables"] },
    };

    await appendEvent(path, event);
    await expect(appendEvent(path, event)).rejects.toThrow("duplicate event id");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("records corrections as new events and leaves the original record intact", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-correction-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const original = {
      schema_version: 1 as const,
      id: "evidence-1",
      topic: "algebra",
      type: "tutor.action" as const,
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { action: "complete", reason_codes: ["original_reason"], evidence_event_ids: [] },
    };
    await appendEvent(path, original);
    await appendEvent(path, {
      schema_version: 1,
      id: "correction-1",
      topic: "algebra",
      type: "event.corrected",
      occurred_at: "2026-01-01T00:01:00.000Z",
      data: { corrects_event_id: "evidence-1", replacement_data: { action: "complete", reason_codes: ["corrected_reason"], evidence_event_ids: [] }, reason: "reason correction" },
    });

    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(JSON.stringify(original));
    expect(lines[1]).toContain('"corrects_event_id":"evidence-1"');
  });

  test("rejects domain-invalid references before they enter durable history", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-domain-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const dangling = {
      schema_version: 1 as const,
      id: "attempt-1",
      topic: "algebra",
      type: "attempt.recorded" as const,
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { question_id: "missing", concept_id: "missing", answer: "x", correct: false, assistance: "none" },
    };

    await expect(appendEvent(path, dangling)).rejects.toThrow("undeclared concept");
    expect(existsSync(path) ? readFileSync(path, "utf8") : "").toBe("");
  });

  test("rejects backdated dependent events before they can break as-of replay", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-backdated-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    await appendEvent(path, {
      schema_version: 1, id: "concept", topic: "algebra", type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { concept_id: "variables", title: "Variables", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "question", topic: "algebra", type: "question.asked",
      occurred_at: "2026-01-05T00:00:00.000Z",
      data: { question_id: "q", concept_id: "variables", prompt: "What is x?", source_refs: ["book.md"] },
    });

    await expect(appendEvent(path, {
      schema_version: 1, id: "attempt", topic: "algebra", type: "attempt.recorded",
      occurred_at: "2026-01-03T00:00:00.000Z",
      data: { question_id: "q", concept_id: "variables", answer: "a variable", correct: true, assistance: "none" },
    })).rejects.toThrow("question q occurs after dependent event attempt");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
  });

  test("rejects corrections whose topic differs from their target", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-correction-topic-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    await appendEvent(path, {
      schema_version: 1, id: "action", topic: "alpha", type: "tutor.action",
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { action: "complete", reason_codes: ["done"], evidence_event_ids: [] },
    });

    await expect(appendEvent(path, {
      schema_version: 1, id: "fix", topic: "beta", type: "event.corrected",
      occurred_at: "2026-01-01T00:01:00.000Z",
      data: { corrects_event_id: "action", replacement_data: { action: "complete", reason_codes: ["fixed"], evidence_event_ids: [] }, reason: "fix" },
    })).rejects.toThrow("mixed topics");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(1);
  });

  test("rejects a correction that would poison an earlier replay cutoff", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-correction-cutoff-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    await appendEvent(path, {
      schema_version: 1, id: "concept-good", topic: "algebra", type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "good", title: "Good", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "question", topic: "algebra", type: "question.asked",
      occurred_at: "2026-01-02T00:00:00Z",
      data: { question_id: "q", concept_id: "good", prompt: "Original", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "concept-future", topic: "algebra", type: "concept.declared",
      occurred_at: "2026-01-10T00:00:00Z",
      data: { concept_id: "future", title: "Future", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "fix-newer", topic: "algebra", type: "event.corrected",
      occurred_at: "2026-01-08T00:00:00Z",
      data: { corrects_event_id: "question", replacement_data: { question_id: "q", concept_id: "good", prompt: "Newer", source_refs: ["book.md"] }, reason: "newer" },
    });

    await expect(appendEvent(path, {
      schema_version: 1, id: "fix-older", topic: "algebra", type: "event.corrected",
      occurred_at: "2026-01-05T00:00:00Z",
      data: { corrects_event_id: "question", replacement_data: { question_id: "q", concept_id: "future", prompt: "Historically invalid", source_refs: ["book.md"] }, reason: "older" },
    })).rejects.toThrow("undeclared concept");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(4);
  });

  test("rejects a correction that would poison an intermediate replay cutoff", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-correction-intermediate-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    await appendEvent(path, {
      schema_version: 1, id: "concept", topic: "algebra", type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "variables", title: "Variables", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "question-original", topic: "algebra", type: "question.asked",
      occurred_at: "2026-01-02T00:00:00Z",
      data: { question_id: "q1", concept_id: "variables", prompt: "Original", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "question-conflict", topic: "algebra", type: "question.asked",
      occurred_at: "2026-01-06T00:00:00Z",
      data: { question_id: "q2", concept_id: "variables", prompt: "Conflict", source_refs: ["book.md"] },
    });
    await appendEvent(path, {
      schema_version: 1, id: "fix-newer", topic: "algebra", type: "event.corrected",
      occurred_at: "2026-01-08T00:00:00Z",
      data: { corrects_event_id: "question-original", replacement_data: { question_id: "q1", concept_id: "variables", prompt: "Restored", source_refs: ["book.md"] }, reason: "newer" },
    });

    await expect(appendEvent(path, {
      schema_version: 1, id: "fix-older", topic: "algebra", type: "event.corrected",
      occurred_at: "2026-01-05T00:00:00Z",
      data: { corrects_event_id: "question-original", replacement_data: { question_id: "q2", concept_id: "variables", prompt: "Intermediate conflict", source_refs: ["book.md"] }, reason: "older" },
    })).rejects.toThrow("question already declared: q2");
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(4);
  });
});
