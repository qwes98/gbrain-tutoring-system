# CLI reference

All successful commands emit one JSON document. Invalid input exits nonzero and writes a concise error to stderr. Timestamps are RFC 3339 values and should be supplied explicitly for reproducible runs.

## Workspace

- `gbrain-tutor init WORKSPACE`
- `gbrain-tutor topic init WORKSPACE SLUG --title TITLE --source FILE`

Generators create missing files and refuse to overwrite an existing topic.

## App-facing queries (v0.2)

These commands return schema-validated documents defined by `schemas/app-contract.v1.schema.json`, so an application never parses internal projection files.

- `workspace list WORKSPACE...` returns a `workspace_list`.
- `topic list WORKSPACE` returns a `topic_list`.
- `topic open|resume TOPIC_DIR` returns a `topic_snapshot` with the active PDF identity (`exact`, `changed`, or `unavailable`), the reading resume point, and the study plane.
- `projection get TOPIC_DIR --as-of RFC3339` returns a `projection_snapshot`.
- `receipt get TOPIC_DIR --request-id KEY` returns the durable `command_receipt` for an already committed command.

## Retry-safe commands (v0.2)

Every mutating command accepts `--request-id KEY`. A repeated key with the same payload returns the original receipt without appending a second record; a repeated key with a different command or payload is rejected. `next --request-id KEY --at RFC3339` performs policy selection and the `tutor.action` append inside one ledger transaction.

## Study state (v0.2)

Study state lives in `study/events.jsonl`, separate from the learning ledger. Reading progress, highlights, and comments never change concept state.

- `pdf register TOPIC_DIR --request-id KEY --document ID --relative-path sources/FILE --pages N --at RFC3339`
- `study progress set TOPIC_DIR --request-id KEY --chapter ID --page N --position 0..1 --completed true|false --at RFC3339`
- `study highlight add TOPIC_DIR --request-id KEY --highlight ID --anchor-json JSON --at RFC3339`
- `study highlight delete TOPIC_DIR --request-id KEY --highlight ID --at RFC3339`
- `study comment add TOPIC_DIR --request-id KEY --comment ID --text TEXT --anchor-json JSON [--candidate-json JSON] --at RFC3339`
- `study comment delete TOPIC_DIR --request-id KEY --comment ID --at RFC3339`
- `study conversation add TOPIC_DIR --request-id KEY --turn ID --speaker learner|tutor --text TEXT [--anchor-json JSON] --at RFC3339`

An anchor carries `document_id`, `document_sha256`, `physical_page`, an optional `display_label`, a `kind` of `text`, `region`, or `page`, the matching `selected_text` or normalized region, and a `status` of `exact`, `ambiguous`, or `unavailable`. Highlights and comments are independent: deleting one never deletes the other, even at a shared anchor. A comment may open a question or misconception candidate that stays traceable to that comment without changing mastery.

## Context packets (v0.2)

- `context build TOPIC_DIR --question TEXT --source-excerpt-json JSON... --as-of RFC3339 --max-items N --max-chars N`

The packet labels each item by role — `source_excerpt`, `learner_comment`, `reading_progress`, `prior_conversation`, `ledger_evidence`, `projection_state` — preserves anchors, enforces the item and character bounds, and reports omitted and truncated counts. The same inputs always produce byte-identical output.

## Ledger events

- `record concept TOPIC_DIR --concept ID --title TITLE --source-ref REF`
- `record question TOPIC_DIR --question ID --concept ID --prompt TEXT --source-ref REF`
- `record attempt TOPIC_DIR --question ID --concept ID --answer TEXT --correct true|false --assistance none|hint|explanation`
- `record evidence TOPIC_DIR --concept ID --kind source|attempt|observation --summary TEXT [--source-ref REF]`
- `record misconception TOPIC_DIR --misconception ID --concept ID --description TEXT --evidence-event EVENT_ID`
- `resolve-misconception TOPIC_DIR --misconception ID --evidence-event EVENT_ID`
- `correct TOPIC_DIR --event EVENT_ID --replacement-data JSON --reason TEXT`

Event commands accept optional `--id` and `--at`; generated IDs and wall-clock timestamps are used otherwise.

## Policy, replay, and export

- `next TOPIC_DIR [--id ID] [--at RFC3339]` rebuilds state, selects one action, appends it, refreshes projections, and returns the selected concept/question context. A `schedule_review` decision includes its deterministic three-day `due_at`.
- `schedule-review TOPIC_DIR --concept ID --due RFC3339 --reason-event EVENT_ID... [--at RFC3339]` requires a future due time during replay.
- `project TOPIC_DIR [--as-of RFC3339]` rebuilds every projection from the ledger. It publishes a complete generation and atomically updates `projections/current.json`; resolve files through that manifest.
- `export-gbrain TOPIC_DIR [--as-of RFC3339]` writes `exports/gbrain-promotion-candidates.json` without changing GBrain.
- `doctor [--skill SKILL.md]` checks Bun, probes Linux procfs plus the required kernel-backed atomic-write and ledger-lock operations in a temporary directory, validates a sample event, and checks the delivered Hermes skill path.
