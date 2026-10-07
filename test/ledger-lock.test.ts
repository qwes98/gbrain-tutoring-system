import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent, processIdentity, readLedger, reclaimStaleLedgerLocks, transactLedger } from "../src/ledger.ts";

function openDescriptorsUnder(root: string): string[] {
  return readdirSync("/proc/self/fd").flatMap((name) => {
    try {
      const target = readlinkSync(join("/proc/self/fd", name));
      return target.includes(root) ? [target] : [];
    } catch { return []; }
  });
}

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

  test("cannot unlink a same-path replacement published after the final ownership check", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-same-path-interleave-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const stale = join(lockDir, "ticket-000000000001-stale.json");
    const replacement = JSON.stringify({ token: "stale", ticket: 1, pid: process.pid, process_identity: processIdentity(process.pid), acquired_at: 10_000 });
    writeFileSync(stale, JSON.stringify({ token: "stale", ticket: 1, pid: 999_999_999, process_identity: "missing", acquired_at: 0 }));

    reclaimStaleLedgerLocks(ledger, {
      staleAfterMs: 1,
      now: 10_000,
      afterOwnershipCheck: (entryPath) => {
        unlinkSync(entryPath);
        writeFileSync(entryPath, replacement);
      },
    });

    expect(existsSync(stale)).toBe(true);
    expect(readFileSync(stale, "utf8")).toBe(replacement);
  });

  test("cannot unlink a same-inode replacement published after the final ownership check", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-same-inode-interleave-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    const stale = join(lockDir, "ticket-000000000001-stale.json");
    const replacement = JSON.stringify({ token: "stale", ticket: 1, pid: process.pid, process_identity: processIdentity(process.pid), acquired_at: 10_000 });
    writeFileSync(stale, JSON.stringify({ token: "stale", ticket: 1, pid: process.pid, process_identity: "prior-process", acquired_at: 0 }));

    reclaimStaleLedgerLocks(ledger, {
      staleAfterMs: 1,
      now: 10_000,
      afterOwnershipCheck: (entryPath) => writeFileSync(entryPath, replacement),
    });

    expect(existsSync(stale)).toBe(true);
    expect(readFileSync(stale, "utf8")).toBe(replacement);
  });

  test("a restore collision cannot strand a live reclaim claim in the ticket queue", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-claim-collision-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(ledger, "");
    const stale = join(lockDir, "ticket-000000000001-stale.json");
    const live = JSON.stringify({ token: "stale", ticket: 1, pid: process.pid, process_identity: processIdentity(process.pid), acquired_at: 10_000 });
    writeFileSync(stale, JSON.stringify({ token: "stale", ticket: 1, pid: process.pid, process_identity: "prior-process", acquired_at: 0 }));
    let claimed = false;

    reclaimStaleLedgerLocks(ledger, {
      staleAfterMs: 1,
      now: 10_000,
      afterOwnershipCheck: (entryPath) => writeFileSync(entryPath, live),
      afterClaim: (entryPath) => {
        claimed = true;
        writeFileSync(entryPath, "collision sentinel\n");
      },
    });

    expect(claimed).toBe(true);
    expect(readFileSync(stale, "utf8")).toBe("collision sentinel\n");
    await appendEvent(ledger, {
      schema_version: 1,
      id: "after-collision",
      topic: "locking",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "locking", title: "Locking", source_refs: ["source.md"] },
    });
    expect(readdirSync(lockDir).filter((name) => name.startsWith(".reclaim-"))).toEqual([]);
  });

  test("ticket cleanup failure still releases the inode lock and every descriptor", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-cleanup-failure-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    mkdirSync(join(root, "ledger"));
    writeFileSync(ledger, "");
    const lockDir = `${ledger}.lock`;
    const first = {
      schema_version: 1 as const,
      id: "first",
      topic: "locking",
      type: "concept.declared" as const,
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "locking", title: "Locking", source_refs: ["source.md"] },
    };

    await expect(transactLedger(ledger, () => {
      const ticket = readdirSync(lockDir).find((name) => name.startsWith("ticket-"));
      if (!ticket) throw new Error("ticket entry missing during transaction");
      rmSync(join(lockDir, ticket));
      mkdirSync(join(lockDir, ticket));
      return { event: first, value: undefined };
    })).rejects.toThrow();

    expect(readLedger(ledger).events.map((event) => event.id)).toEqual(["first"]);
    expect(openDescriptorsUnder(root)).toEqual([]);
    await appendEvent(ledger, {
      schema_version: 1,
      id: "second",
      topic: "locking",
      type: "evidence.recorded",
      occurred_at: "2026-01-01T00:00:01Z",
      data: { concept_id: "locking", kind: "observation", summary: "Lock cleanup completed" },
    });
    expect(readLedger(ledger).events.map((event) => event.id)).toEqual(["first", "second"]);
  }, 10_000);

  test("ticket acquisition failure still closes the ticket and lock-directory descriptors", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-lock-acquire-cleanup-"));
    roots.push(root);
    const ledger = join(root, "ledger", "events.jsonl");
    const lockDir = `${ledger}.lock`;
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(ledger, "");
    writeFileSync(join(lockDir, "ticket-000000000001-blocker.json"), JSON.stringify({
      token: "blocker",
      ticket: 1,
      pid: process.pid,
      process_identity: processIdentity(process.pid),
      acquired_at: Date.now(),
    }));
    const pending = appendEvent(ledger, {
      schema_version: 1,
      id: "blocked",
      topic: "locking",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "locking", title: "Locking", source_refs: ["source.md"] },
    });
    const deadline = Date.now() + 2_000;
    let ticket: string | undefined;
    while (!ticket) {
      ticket = readdirSync(lockDir).find((name) => name.startsWith("ticket-") && !name.includes("blocker"));
      if (Date.now() >= deadline) throw new Error("timed out waiting for the blocked ticket");
      if (!ticket) await Bun.sleep(5);
    }
    rmSync(join(lockDir, ticket));
    mkdirSync(join(lockDir, ticket));

    await expect(pending).rejects.toThrow();
    expect(openDescriptorsUnder(root)).toEqual([]);
  }, 10_000);

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
