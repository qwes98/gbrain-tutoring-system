import { appendEvent } from "../../src/ledger.ts";

const [ledger, workerText, countText] = process.argv.slice(2);
if (!ledger || !workerText || !countText) throw new Error("usage: append-worker LEDGER WORKER COUNT");
const worker = Number(workerText);
const count = Number(countText);
for (let index = 0; index < count; index += 1) {
  await appendEvent(ledger, {
    schema_version: 1,
    id: `worker-${worker}-event-${index}`,
    topic: "concurrency",
    type: "tutor.action",
    occurred_at: new Date(Date.UTC(2026, 0, 1, 0, worker, index)).toISOString(),
    data: { action: "complete", reason_codes: [`worker_${worker}_event_${index}`], evidence_event_ids: [] },
  });
}
