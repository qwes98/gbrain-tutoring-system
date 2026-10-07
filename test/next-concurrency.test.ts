import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, processIdentity, readLedger } from "../src/ledger.ts";
import { createProject, createTopic } from "../src/workspace.ts";
import type { LedgerEvent } from "../src/types.ts";

describe("concurrent next transactions", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("selects and appends atomically across 20 CLI processes", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-next-concurrency-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "source.md");
    writeFileSync(source, "# Concurrency\n");
    createProject(workspace);
    const topicDir = createTopic(workspace, { slug: "concurrency", title: "Concurrency", source });
    const ledgerPath = join(topicDir, "ledger", "events.jsonl");
    const seed: LedgerEvent[] = [
      { schema_version: 1, id: "concept", topic: "concurrency", type: "concept.declared", occurred_at: "2026-01-01T00:00:00Z", data: { concept_id: "mutex", title: "Mutex", source_refs: ["sources/source.md"] } },
      { schema_version: 1, id: "question", topic: "concurrency", type: "question.asked", occurred_at: "2026-01-01T00:01:00Z", data: { question_id: "q", concept_id: "mutex", prompt: "What does it protect?", source_refs: ["sources/source.md"] } },
      { schema_version: 1, id: "wrong-attempt", topic: "concurrency", type: "attempt.recorded", occurred_at: "2026-01-01T00:03:00Z", data: { question_id: "q", concept_id: "mutex", answer: "the CPU", correct: false, assistance: "none" } },
    ];
    for (const event of seed) await appendEvent(ledgerPath, event);

    const lockDir = `${ledgerPath}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const blocker = join(lockDir, "ticket-000000000001-test-blocker.json");
    writeFileSync(blocker, JSON.stringify({
      token: "test-blocker",
      ticket: 1,
      pid: process.pid,
      process_identity: processIdentity(process.pid),
      acquired_at: Date.now(),
    }));

    const processes = Array.from({ length: 20 }, (_, index) => Bun.spawn([
      process.execPath,
      join(import.meta.dir, "..", "src", "cli.ts"),
      "next",
      topicDir,
      "--id",
      `next-${String(index).padStart(2, "0")}`,
      "--at",
      "2026-01-01T00:03:00Z",
    ], { stdout: "pipe", stderr: "pipe" }));

    const deadline = Date.now() + 10_000;
    while (readdirSync(lockDir).filter((name) => name.startsWith("ticket-") && !name.includes("test-blocker")).length < 1) {
      if (Date.now() >= deadline) throw new Error("timed out waiting for the concurrent next transaction to queue");
      await Bun.sleep(10);
    }
    await Bun.sleep(100);
    unlinkSync(blocker);

    const exits = await Promise.all(processes.map((child) => child.exited));
    const errors = await Promise.all(processes.map(async (child) => new Response(child.stderr).text()));
    expect(exits, errors.join("\n")).toEqual(Array(20).fill(0));

    const actions = readLedger(ledgerPath).events.filter((event) => event.type === "tutor.action");
    const hints = actions.filter((event) => event.data.action === "give_hint");
    const explanations = actions.filter((event) => event.data.action === "explain_bottleneck");
    expect(actions).toHaveLength(20);
    expect(hints).toHaveLength(1);
    expect(explanations).toHaveLength(19);
    for (const explanation of explanations) {
      expect(explanation.data).toMatchObject({
        reason_codes: ["hint_limit_reached", "single_bottleneck"],
        evidence_event_ids: ["wrong-attempt", hints[0]!.id],
      });
    }

    const outputs = await Promise.all(processes.map(async (child) => JSON.parse(await new Response(child.stdout).text()) as { action_event_id: string }));
    expect(new Set(outputs.map((output) => output.action_event_id))).toEqual(new Set(actions.map((action) => action.id)));
    expect(readFileSync(ledgerPath, "utf8").endsWith("\n")).toBe(true);
  }, 30_000);
});
