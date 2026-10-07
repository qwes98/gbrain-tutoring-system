---
name: gbrain-tutor
description: Select and record one evidence-based tutoring action.
version: 0.2.0
author: GBrain Tutoring System contributors
license: MIT
platforms: [linux]
metadata:
  hermes:
    tags: [gbrain, tutoring, ledger, review]
    related_skills: []
    requires_toolsets: [terminal]
---

# GBrain Tutor

## Overview

Operate one deterministic tutoring turn against a topic workspace. The CLI owns validation, replay, policy selection, and append-only writes; this skill interprets the selected action and reports the result.

## When to Use

Use this skill when asked to continue, inspect, or run a tutoring topic stored by GBrain Tutoring System v0.1 or later, or when asked which single tutoring action is warranted by its ledger.

## Prerequisites

- `gbrain-tutor` is available on `PATH`.
- The topic directory contains `topic.json` and `ledger/events.jsonl`.
- The source files referenced by the topic remain local and readable.

## Procedure

1. Set `TOPIC_DIR` to the topic directory supplied by the operator. Do not infer a different topic.
2. Rebuild the topic projection with `terminal(command="gbrain-tutor project \"$TOPIC_DIR\" --as-of \"$TURN_TIME\"")`, where `TURN_TIME` is an explicit RFC 3339 timestamp.
3. Select and record exactly one policy action with `terminal(command="gbrain-tutor next \"$TOPIC_DIR\" --at \"$TURN_TIME\"")`.
4. Read the JSON `decision` and JSON `context`. Preserve the decision's `action`, `concept_id`, `question_id`, `reason_codes`, and `evidence_event_ids`; use `context.question.prompt` and its `source_refs` for the selected turn. Bind `CONCEPT_ID` to `decision.concept_id` and, when present, bind `DECISION_DUE_AT` to `decision.due_at` without recalculating either timestamp.
5. Carry out only that action:
   - `elicit_attempt`: present the selected question without explanation.
   - `give_hint`: read the referenced local source, then provide one bounded hint, not a full explanation.
   - `explain_bottleneck`: read the referenced local source, then explain only the selected concept and question.
   - `ask_due_review`: present the selected due-review question.
   - `schedule_review`: append the delayed review with `terminal(command="gbrain-tutor schedule-review \"$TOPIC_DIR\" --concept \"$CONCEPT_ID\" --due \"$DECISION_DUE_AT\" --reason-event \"$EVIDENCE_EVENT_ID_1\" [--reason-event \"$EVIDENCE_EVENT_ID_N\" ...] --at \"$TURN_TIME\"")`. Supply one `--reason-event` for every `decision.evidence_event_ids` entry. The review event must retain the original `TURN_TIME`, including for historical turns.
   - `complete`: report that no actionable bottleneck remains.
6. If an answer or observation must be recorded, use the matching `gbrain-tutor record` command. Never edit `events.jsonl`.
7. Expose promotion candidates with `terminal(command="gbrain-tutor export-gbrain \"$TOPIC_DIR\" --as-of \"$TURN_TIME\"")` and report the output path and count.

## Quick Reference

```text
gbrain-tutor project TOPIC_DIR --as-of RFC3339
gbrain-tutor next TOPIC_DIR --at RFC3339
gbrain-tutor record attempt TOPIC_DIR --question ID --concept ID --answer TEXT --correct true|false --assistance none|hint|explanation --at RFC3339
gbrain-tutor schedule-review TOPIC_DIR --concept ID --due RFC3339 --reason-event EVENT_ID --at RFC3339
gbrain-tutor export-gbrain TOPIC_DIR --as-of RFC3339
```

## Pitfalls

- Never write to GBrain directly. The export is a promotion-candidate boundary and does not authorize automatic promotion.
- Never edit or compact the event ledger. Record corrections with `gbrain-tutor correct`.
- Do not provide an explanation before the policy selects `explain_bottleneck`.
- Do not combine multiple bottlenecks or silently omit policy reasons.
- Do not claim an assisted correct attempt as stable promotion evidence.

## Verification

Run `gbrain-tutor doctor --skill /path/to/gbrain-tutor/SKILL.md`. For a topic turn, confirm that `next` returned one decision and one `action_event_id`, then rebuild projections. Read `projections/current.json`, take its `generation_id`, and confirm the action appears in `projections/generations/<generation_id>/topic-state.json`. Resolve projection files only through the current manifest; do not choose a generation by directory listing.
