import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("v0.1 CLI acceptance", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("runs a local source through initialization, tutoring, replay, review, and GBrain export", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-acceptance-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(import.meta.dir, "fixtures", "concurrency-lecture.md");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (exit !== 0) throw new Error(`command failed (${args.join(" ")}): ${stderr}`);
      return JSON.parse(stdout) as Record<string, unknown>;
    };

    expect((await run("doctor")).checks).toMatchObject({ storage: true });

    await run("init", workspace);
    await run("topic", "init", workspace, "concurrency", "--title", "Concurrency Control", "--source", source);
    const topic = join(workspace, "topics", "concurrency");
    await run("record", "concept", topic, "--id", "c-append", "--concept", "append", "--title", "Append-only logs", "--source-ref", "sources/concurrency-lecture.md#concurrency-control-lecture-note", "--at", "2026-01-01T00:00:00.000Z");
    await run("record", "evidence", topic, "--id", "e-source", "--concept", "append", "--kind", "source", "--summary", "The source defines correction as a new record.", "--source-ref", "sources/concurrency-lecture.md", "--at", "2026-01-01T00:01:00.000Z");
    await run("record", "question", topic, "--id", "q1-event", "--question", "q1", "--concept", "append", "--prompt", "How is a correction represented?", "--source-ref", "sources/concurrency-lecture.md", "--at", "2026-01-01T00:02:00.000Z");
    await run("record", "attempt", topic, "--id", "a1", "--question", "q1", "--concept", "append", "--answer", "As another record", "--correct", "true", "--assistance", "none", "--at", "2026-01-01T00:03:00.000Z");
    await run("record", "question", topic, "--id", "q2-event", "--question", "q2", "--concept", "append", "--prompt", "What terminates a complete JSONL record?", "--source-ref", "sources/concurrency-lecture.md", "--at", "2026-01-01T00:04:00.000Z");
    await run("record", "attempt", topic, "--id", "a2", "--question", "q2", "--concept", "append", "--answer", "A newline", "--correct", "true", "--assistance", "none", "--at", "2026-01-01T00:05:00.000Z");
    const next = await run("next", topic, "--id", "action-1", "--at", "2026-01-01T00:06:00.000Z");
    expect((next.decision as { action: string }).action).toBe("schedule_review");
    expect((next.decision as { due_at: string }).due_at).toBe("2026-01-04T00:06:00.000Z");
    expect((next.context as { concept: { title: string } }).concept.title).toBe("Append-only logs");
    await run("schedule-review", topic, "--id", "review-1", "--concept", "append", "--due", "2026-01-04T00:00:00.000Z", "--reason-event", "a1", "--reason-event", "a2", "--at", "2026-01-01T00:07:00.000Z");
    await run("project", topic, "--as-of", "2026-01-02T00:00:00.000Z");
    const exported = await run("export-gbrain", topic, "--as-of", "2026-01-02T00:00:00.000Z");

    expect(exported.candidate_count).toBe(1);
    const candidates = JSON.parse(readFileSync(join(topic, "exports", "gbrain-promotion-candidates.json"), "utf8"));
    expect(candidates.candidates[0].concept_id).toBe("append");
    expect(candidates.candidates[0].qualifying_evidence_event_ids).toEqual(["a1", "a2"]);
    const ledger = readFileSync(join(topic, "ledger", "events.jsonl"), "utf8");
    expect(ledger).toContain('"type":"tutor.action"');
    expect(ledger).toContain('"type":"review.scheduled"');
  }, 30_000);
});
