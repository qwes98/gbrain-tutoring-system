# CLI reference

All successful commands emit one JSON document. Invalid input exits nonzero and writes a concise error to stderr. Timestamps are RFC 3339 values and should be supplied explicitly for reproducible runs.

## Workspace

- `gbrain-tutor init WORKSPACE`
- `gbrain-tutor topic init WORKSPACE SLUG --title TITLE --source FILE`

Generators create missing files and refuse to overwrite an existing topic.

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
- `doctor [--skill SKILL.md]` checks Bun, the event validator, and the delivered Hermes skill path.
