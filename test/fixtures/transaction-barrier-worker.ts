import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transactLedger } from "../../src/ledger.ts";

const [ledger, role, signals] = process.argv.slice(2);
if (!ledger || !role || !signals) throw new Error("usage: transaction-barrier-worker LEDGER ROLE SIGNALS");

const event = {
  schema_version: 1 as const,
  id: "shared-concept",
  topic: "locking",
  type: "concept.declared" as const,
  occurred_at: "2026-01-01T00:00:00Z",
  data: { concept_id: "locking", title: "Locking", source_refs: ["source.md"] },
};

if (role === "b") writeFileSync(join(signals, "b-started"), "");

await transactLedger(ledger, () => {
  writeFileSync(join(signals, `${role}-entered`), "");
  const release = join(signals, `release-${role}`);
  while (!existsSync(release)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  return { event, value: undefined };
});
