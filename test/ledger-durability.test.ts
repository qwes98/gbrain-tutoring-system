import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("ledger creation durability", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("fsyncs both a newly created ledger and its parent directory", async () => {
    if (process.platform !== "linux") return;
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-ledger-fsync-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const trace = join(root, "fsync.trace");
    const child = Bun.spawn([
      "strace", "-f", "-e", "trace=fsync", "-yy", "-o", trace,
      process.execPath, join(import.meta.dir, "fixtures", "append-worker.ts"), ledger, "0", "1",
    ], { stdout: "pipe", stderr: "pipe" });
    expect(await child.exited).toBe(0);
    const calls = readFileSync(trace, "utf8");
    expect(calls).toContain(`<${ledger}>`);
    expect(calls).toContain(`<${join(root, "ledger")}>`);
  });
});
