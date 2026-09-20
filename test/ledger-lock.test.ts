import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processIdentity, reclaimStaleLedgerLocks } from "../src/ledger.ts";

describe("ledger lock ownership", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("reclaiming one stale owner cannot unlink a concurrently published replacement", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-interleave-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const stale = join(lockDir, "ticket-000000000001-stale.json");
    writeFileSync(stale, JSON.stringify({ token: "stale", ticket: 1, pid: 999_999_999, process_identity: "missing", acquired_at: 0 }));

    reclaimStaleLedgerLocks(ledger, {
      staleAfterMs: 1,
      now: 10_000,
      beforeReclaim: (entryPath) => {
        rmSync(entryPath);
        writeFileSync(entryPath, JSON.stringify({ token: "fresh", ticket: 1, pid: process.pid, process_identity: processIdentity(process.pid), acquired_at: 10_000 }));
      },
    });

    expect(existsSync(stale)).toBe(true);
    expect(JSON.parse(readFileSync(stale, "utf8")).token).toBe("fresh");
  });

  test("an owner published after the final ownership check remains intact", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-critical-interleave-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const stale = join(lockDir, "ticket-000000000001-stale.json");
    const fresh = join(lockDir, "ticket-000000000002-fresh.json");
    writeFileSync(stale, JSON.stringify({ token: "stale", ticket: 1, pid: 999_999_999, process_identity: "missing", acquired_at: 0 }));

    reclaimStaleLedgerLocks(ledger, {
      staleAfterMs: 1,
      now: 10_000,
      afterOwnershipCheck: () => {
        writeFileSync(fresh, JSON.stringify({ token: "fresh", ticket: 2, pid: process.pid, process_identity: processIdentity(process.pid), acquired_at: 10_000 }));
      },
    });

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
  });

  test("reclaims a stale ticket when a live PID has a different process identity", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-pid-reuse-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const reused = join(lockDir, "ticket-000000000001-reused.json");
    writeFileSync(reused, JSON.stringify({ token: "reused", ticket: 1, pid: process.pid, process_identity: "prior-process", acquired_at: 0 }));

    reclaimStaleLedgerLocks(ledger, { staleAfterMs: 1, now: 10_000 });

    expect(existsSync(reused)).toBe(false);
  });
});
