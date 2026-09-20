# Architecture and event model

## Files

Each repository has a versioned `gbrain-tutor.json`, the published event schema, and topic directories. Each topic contains copied local sources, `ledger/events.jsonl`, the separate `study/events.jsonl` study plane, disposable projections, and GBrain candidate exports.

The ledger is the system of record. The bundled `schemas/ledger-event.schema.json` is the runtime v1 contract; workspace initialization publishes an identical snapshot for tools and operators. Each append validates against that bundled schema, validates the candidate replay while holding a cross-process lock, checks all prior IDs, writes one complete JSONL record with append semantics, fsyncs it, and releases the lock. Policy-driven `next` calls hold that same lock across projection, selection, and `tutor.action` append, so concurrent callers reselect against the committed predecessor. Correction candidates are replayed at every distinct affected event instant so a later winner cannot mask an invalid historical interval. The lock combines a kernel lock on the opened ledger inode with immutable, atomically published per-owner choosing/ticket entries, so replacing the ticket directory cannot split transactions on the same ledger. Stale ownership requires age plus a dead process or changed process-start identity; removal pins the inspected inode and full owner bytes, renames it to a private non-ticket claim, and unlinks only that exact owner. A correction is an `event.corrected` record carrying replacement data for an earlier event. The earlier line remains unchanged; the correction with the latest instant wins, with event ID as the deterministic tie-break.

Readers fail on invalid UTF-8, invalid events, blank records, duplicate IDs, interior corruption, and unterminated tails by default. Explicit recovery mode may ignore only the final unterminated record and reports the discarded text. Appends never use recovery mode. New ledger creation fsyncs both the file and parent directory. Managed workspace, topic, ledger, atomic-write, and projection mutations walk from a held root descriptor, reject symlink components, and address children through descriptor-relative procfs paths; ancestor renames or substitutions therefore cannot redirect an in-flight operation. Atomic file replacement hard-links the held temporary descriptor and uses a kernel exchange plus inode verification, so substituting a temporary pathname cannot publish attacker-selected bytes. These guarantees require Linux procfs and fail closed when that capability is unavailable. A dependent event cannot predate the concept, question, misconception, or evidence it cites; independent events may still be appended concurrently in any timestamp order.

## Projection

Replay is a pure reduction of validated events at or before the caller-supplied strict RFC 3339 `as_of` timestamp. Instant comparison preserves arbitrary fractional-second precision instead of truncating through platform date parsing. Events replay by exact instant, with causal dependencies first and event ID ordering among ready equal-instant events, so append order cannot change mastery, latest-attempt, evidence, review-completion, or policy semantics. Later events and corrections are excluded. Existing projection files are never inputs. Collections have explicit ordering, and due reviews retire on the earliest qualifying attempt across all concept questions.

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

## App contract, commands, and study state

`schemas/app-contract.v1.schema.json` is the versioned application boundary. Workspace lists, topic lists, topic snapshots, projection snapshots, tutor decisions, and command receipts validate against it, so a client never reads generation directories or internal projection files.

Mutating commands carry a client request key and a payload hash. Replaying a committed key returns the stored receipt without appending a second record; reusing a key for a different command or payload is rejected. Tutor selection and its `tutor.action` append happen inside one ledger transaction, so a retry after a lost response cannot advance the policy twice.

Study state is a second append-only journal at `study/events.jsonl`. It holds the registered PDF identity, reading progress, highlights, comments, comment-derived question or misconception candidates, and conversation turns. Anchors record document identity and sha256, the physical page, an optional display label, text, region, or page-level scope, and an `exact`, `ambiguous`, or `unavailable` status. Reopening a topic rehashes the owned source and reports `exact`, `changed`, or `unavailable` without rewriting stored anchors. Nothing in the study plane changes concept state; only qualifying ledger evidence does, and every transition still cites its evidence event IDs.

Context packets are a pure function of the question, supplied source excerpts, study state, and a projection. Items are labeled `source_excerpt`, `learner_comment`, `reading_progress`, `prior_conversation`, `ledger_evidence`, or `projection_state`, anchors survive intact, and item and character bounds are enforced with explicit omitted and truncated counts.

## Proven GBrain principles reused

The design follows patterns inspected in `../gbrain`: Bun/TypeScript command modules, checked-in strict schemas, append-only JSONL, kernel-atomic locking around read/modify/write work, fsync plus atomic publication for derived files, deterministic replay, and explicit provenance-preserving promotion boundaries. The tutoring implementation is independent and does not copy private GBrain modules or add GBrain tables.
