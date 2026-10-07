import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger } from "../src/ledger.ts";

describe("ledger recovery", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("fails closed by default and explicitly recovers only a truncated tail", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-recovery-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const valid = {
      schema_version: 1,
      id: "concept-1",
      topic: "algebra",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00.000Z",
      data: { concept_id: "variables", title: "Variables", source_refs: ["sources/book.md#variables"] },
    };
    writeFileSync(path, `${JSON.stringify(valid)}\n{\"schema_version\":1,\"id\":\"torn`);

    expect(() => readLedger(path)).toThrow("unterminated final record");
    const recovered = readLedger(path, { truncatedTail: "recover" });
    expect(recovered.events.map((event) => event.id)).toEqual(["concept-1"]);
    expect(recovered.recovered_truncated_tail).toBe(true);
    expect(recovered.truncated_tail).toBe('{"schema_version":1,"id":"torn');
  });

  test("never skips corrupt interior records in recovery mode", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-corrupt-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    writeFileSync(path, '{"broken":\n{}\npartial');

    expect(() => readLedger(path, { truncatedTail: "recover" })).toThrow("invalid JSONL at line 1");
  });

  test("fails closed on invalid UTF-8 inside an otherwise valid record", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-utf8-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const prefix = Buffer.from('{"schema_version":1,"id":"evidence","topic":"algebra","type":"evidence.recorded","occurred_at":"2026-01-01T00:00:00.000Z","data":{"concept_id":"variables","kind":"observation","summary":"');
    const invalidUtf8 = Buffer.from([0xc3, 0x28]);
    const suffix = Buffer.from('"}}\n');
    writeFileSync(path, Buffer.concat([prefix, invalidUtf8, suffix]));

    expect(() => readLedger(path)).toThrow("invalid UTF-8");
  });

  test("rejects blank records inside JSONL history", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-blank-record-"));
    roots.push(root);
    const path = join(root, "events.jsonl");
    const first = { schema_version: 1, id: "one", topic: "algebra", type: "evidence.recorded", occurred_at: "2026-01-01T00:00:00.000Z", data: { concept_id: "variables", kind: "observation", summary: "one" } };
    const second = { ...first, id: "two", data: { ...first.data, summary: "two" } };
    writeFileSync(path, `${JSON.stringify(first)}\n\n${JSON.stringify(second)}\n`);

    expect(() => readLedger(path)).toThrow("blank JSONL record at line 2");
  });
});
