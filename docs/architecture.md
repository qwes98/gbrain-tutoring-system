# Architecture and event model

## Files

Each repository has a versioned `gbrain-tutor.json`, the published event schema, and topic directories. Each topic contains copied local sources, `ledger/events.jsonl`, disposable projections, and GBrain candidate exports.

The ledger is the system of record. The bundled `schemas/ledger-event.schema.json` is the runtime v1 contract; workspace initialization publishes an identical snapshot for tools and operators. Each append validates against that bundled schema, validates the candidate replay while holding a cross-process lock, checks all prior IDs, writes one complete JSONL record with append semantics, fsyncs it, and releases the lock. Correction candidates are replayed at every distinct affected event instant so a later winner cannot mask an invalid historical interval. The lock uses immutable, atomically published per-owner choosing/ticket entries rather than a replaceable singleton pathname. Stale ownership requires age plus a dead process or changed process-start identity. A correction is an `event.corrected` record carrying replacement data for an earlier event. The earlier line remains unchanged; the correction with the latest instant wins, with event ID as the deterministic tie-break.

Readers fail on invalid UTF-8, invalid events, blank records, duplicate IDs, interior corruption, and unterminated tails by default. Explicit recovery mode may ignore only the final unterminated record and reports the discarded text. Appends never use recovery mode. New ledger creation fsyncs both the file and parent directory. Managed workspace, topic, ledger, atomic-write, and projection paths reject lexical escape, canonical escape, and symbolic-link traversal. A dependent event cannot predate the concept, question, misconception, or evidence it cites; independent events may still be appended concurrently in any timestamp order.

## Projection

Replay is a pure reduction of validated events at or before the caller-supplied strict RFC 3339 `as_of` timestamp. Instant comparison preserves arbitrary fractional-second precision instead of truncating through platform date parsing. Later events and corrections are excluded. Existing projection files are never inputs. Collections have explicit ordering, and due reviews retire when a later unassisted correct attempt supplies completion evidence.

Projection files are published as one content-addressed generation under `projections/generations/<generation_id>/`. Files and generation directories are fsynced before `projections/current.json` is atomically replaced. Readers resolve only the current manifest, so a crash or concurrent writer cannot expose a mixed generation. Orphaned unpublished generations are disposable because the ledger remains authoritative.

Concept state changes include `state_history` entries with supporting event IDs. Assisted correct attempts are counted separately and cannot qualify a concept for stable promotion. Stable status requires two unassisted correct attempts on distinct questions, no open misconception, and an unassisted correct latest attempt.

## Policy order

The policy chooses exactly one action in this order:

1. Earliest due review.
2. An unanswered question, preserving evidence-before-explanation.
3. Explanation after a failed assisted attempt, or after the one recorded hint for the current attempt has been consumed.
4. One bounded hint after an unassisted incorrect attempt.
5. Delayed review after stable evidence.
6. Completion when no actionable bottleneck exists.

Every decision includes inspectable `reason_codes` and `evidence_event_ids`. Due reviews are ordered by parsed instants, not timestamp text. The CLI appends the decision as `tutor.action` before returning it, and the event schema requires fields appropriate to each action.

## Proven GBrain principles reused

The design follows patterns inspected in `../gbrain`: Bun/TypeScript command modules, checked-in strict schemas, append-only JSONL, kernel-atomic locking around read/modify/write work, sibling temp + fsync + rename for derived files, deterministic replay, and explicit provenance-preserving promotion boundaries. The tutoring implementation is independent and does not copy private GBrain modules or add GBrain tables.
