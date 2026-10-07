import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function waitFor(path: string, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) return false;
    await Bun.sleep(5);
  }
  return true;
}

describe("ledger lock namespace", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("replacing the ticket directory cannot split one ledger transaction boundary", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-ledger-lock-namespace-"));
    roots.push(root);
    const ledgerDirectory = join(root, "ledger");
    const ledger = join(ledgerDirectory, "events.jsonl");
    const signals = join(root, "signals");
    mkdirSync(ledgerDirectory);
    mkdirSync(signals);
    writeFileSync(ledger, "");
    const worker = join(import.meta.dir, "fixtures", "transaction-barrier-worker.ts");

    const first = Bun.spawn([process.execPath, worker, ledger, "a", signals], { stdout: "pipe", stderr: "pipe" });
    expect(await waitFor(join(signals, "a-entered"))).toBe(true);
    renameSync(`${ledger}.lock`, `${ledger}.lock.moved`);

    const second = Bun.spawn([process.execPath, worker, ledger, "b", signals], { stdout: "pipe", stderr: "pipe" });
    expect(await waitFor(join(signals, "b-started"))).toBe(true);
    const enteredBeforeRelease = await waitFor(join(signals, "b-entered"), 300);
    if (enteredBeforeRelease) {
      writeFileSync(join(signals, "release-b"), "");
      await second.exited;
    }
    writeFileSync(join(signals, "release-a"), "");
    expect(await first.exited).toBe(0);
    if (!enteredBeforeRelease) {
      expect(await waitFor(join(signals, "b-entered"))).toBe(true);
      writeFileSync(join(signals, "release-b"), "");
    }

    expect(await second.exited).not.toBe(0);
    expect(readFileSync(ledger, "utf8").trim().split("\n")).toHaveLength(1);
  }, 10_000);
});
