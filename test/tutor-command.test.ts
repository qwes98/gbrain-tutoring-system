import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { commitLedgerEvent, commitTutorAction, readCommandReceipt } from "../src/commands.ts";
import { validateAppContract } from "../src/contracts.ts";
import { appendEvent, readLedger } from "../src/ledger.ts";
import { createProject, createTopic } from "../src/workspace.ts";

describe("retry-safe tutor commands", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("selects and commits one tutor action atomically for concurrent retries", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-command-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "source.pdf");
    writeFileSync(source, "%PDF-1.4\nquestion\n");
    createProject(workspace);
    const topic = createTopic(workspace, { slug: "atomic", title: "Atomic", source });
    const ledger = join(topic, "ledger", "events.jsonl");
    await appendEvent(ledger, {
      schema_version: 1, id: "concept", topic: "atomic", type: "concept.declared", occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "append", title: "Append", source_refs: ["sources/source.pdf"] },
    });
    await appendEvent(ledger, {
      schema_version: 1, id: "question", topic: "atomic", type: "question.asked", occurred_at: "2026-01-01T00:01:00Z",
      data: { question_id: "q1", concept_id: "append", prompt: "Why append?", source_refs: ["sources/source.pdf"] },
    });

    const receipts = await Promise.all(Array.from({ length: 12 }, () => commitTutorAction(topic, {
      request_id: "next-1",
      occurred_at: "2026-01-01T00:02:00Z",
    })));

    expect(new Set(receipts.map((receipt) => JSON.stringify(receipt))).size).toBe(1);
    const receipt = receipts[0]!;
    expect(validateAppContract("command_receipt", receipt)).toEqual({ valid: true, errors: [] });
    expect(validateAppContract("tutor_decision", receipt.result.decision)).toEqual({ valid: true, errors: [] });
    expect(receipt.result.decision).toMatchObject({ action: "elicit_attempt", evidence_event_ids: ["question"] });
    expect(readCommandReceipt(topic, "next-1")).toEqual(receipt);
    expect(readLedger(ledger).events.filter((event) => event.type === "tutor.action")).toHaveLength(1);
    await expect(commitTutorAction(topic, { request_id: "next-1", occurred_at: "2026-01-01T00:03:00Z" }))
      .rejects.toThrow("different command or payload");
  });

  test("commits ordinary ledger mutations once and returns the durable receipt on retry", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-ledger-command-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "source.pdf");
    writeFileSync(source, "%PDF-1.4\nconcept\n");
    createProject(workspace);
    const topic = createTopic(workspace, { slug: "receipts", title: "Receipts", source });
    const event = {
      schema_version: 1 as const,
      id: "ignored-for-keyed-command",
      topic: "receipts",
      type: "concept.declared" as const,
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "append", title: "Append", source_refs: ["sources/source.pdf"] },
    };

    const first = await commitLedgerEvent(topic, "record.concept", "concept-1", event);
    const second = await commitLedgerEvent(topic, "record.concept", "concept-1", { ...event, id: "different-transient-id" });

    expect(second).toEqual(first);
    expect(readCommandReceipt(topic, "concept-1")).toEqual(first);
    expect(readLedger(join(topic, "ledger", "events.jsonl")).events).toHaveLength(1);
    await expect(commitLedgerEvent(topic, "record.concept", "concept-1", { ...event, data: { ...event.data, title: "Different" } }))
      .rejects.toThrow("different command or payload");
  });
});
