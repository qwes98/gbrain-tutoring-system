import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLedger } from "../src/ledger.ts";

describe("concurrent ledger appends", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("serializes independent writer processes without loss or torn records", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-concurrency-"));
    roots.push(root);
    const ledger = join(root, "events.jsonl");
    const processes = Array.from({ length: 6 }, (_, worker) => Bun.spawn([
      process.execPath,
      join(import.meta.dir, "fixtures", "append-worker.ts"),
      ledger,
      String(worker),
      "20",
    ], { stdout: "pipe", stderr: "pipe" }));

    const exits = await Promise.all(processes.map((child) => child.exited));
    expect(exits).toEqual([0, 0, 0, 0, 0, 0]);
    const events = readLedger(ledger).events;
    expect(events).toHaveLength(120);
    expect(new Set(events.map((event) => event.id)).size).toBe(120);
  }, 20_000);
});
