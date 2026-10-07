# GBrain Tutoring System v0.2

A deterministic, offline tutoring ledger with append-only events, replayable projections, an inspectable rule policy, a Bun CLI, and a personal-installable Hermes skill. v0.2 adds an app-facing headless contract: versioned schemas and public types, query commands that never require parsing internal projection files, retry-safe commands with durable receipts, structured PDF identity and source anchors, a separate study-state plane, and a deterministic bounded context packet. GBrain integration stops at an explicit promotion-candidate file; this project never mutates GBrain automatically.

## Requirements

- Linux with procfs. Storage mutations fail closed when descriptor-anchored procfs paths are unavailable.
- [Bun](https://bun.sh/) 1.3 or newer for installing, building, testing, and running the CLI.
- Bash for `scripts/smoke.sh`.
- `strace` for the ledger durability test.
- `git`, `npm`, and `tar` for the full test and package-verification workflow.
- Python 3 only for the optional real Hermes integration test; `python3` is the default executable.

## Install

```bash
bun install
bun link
gbrain-tutor doctor
```

Install the Hermes skill for the current profile:

```bash
mkdir -p ~/.hermes/skills
cp -R skills/gbrain-tutor ~/.hermes/skills/gbrain-tutor
```

A new Hermes session can load it with `hermes --skills gbrain-tutor`. The skill assumes `gbrain-tutor` is on `PATH`.

## Quick start

```bash
gbrain-tutor init ./tutoring-ledger
gbrain-tutor topic init ./tutoring-ledger concurrency \
  --title "Concurrency Control" --source ./test/fixtures/concurrency-lecture.md

TOPIC=./tutoring-ledger/topics/concurrency
gbrain-tutor record concept "$TOPIC" \
  --concept locks --title "Mutual exclusion" \
  --source-ref sources/concurrency-lecture.md --at 2026-01-01T00:00:00Z
gbrain-tutor project "$TOPIC" --as-of 2026-01-01T00:00:00Z
gbrain-tutor next "$TOPIC" --at 2026-01-01T00:00:00Z
gbrain-tutor export-gbrain "$TOPIC" --as-of 2026-01-01T00:00:00Z
```

Headless app-facing calls (v0.2):

```bash
gbrain-tutor workspace list ./tutoring-ledger
gbrain-tutor topic list ./tutoring-ledger
gbrain-tutor topic resume "$TOPIC"
gbrain-tutor projection get "$TOPIC" --as-of 2026-01-01T00:00:00Z
gbrain-tutor next "$TOPIC" --request-id next-1 --at 2026-01-01T00:00:00Z
gbrain-tutor receipt get "$TOPIC" --request-id next-1
```

## Public contract

The core runs offline and validates every event against [the ledger schema](schemas/ledger-event.schema.json). Each accepted event is an append-only JSONL record with a unique ID; corrections append new events. Concurrent writes serialize, and replay deterministically rebuilds derived projections. Concept-state changes and tutor decisions retain the evidence event IDs that justify them. `next` returns a rule-selected action with inspectable reasons.

The versioned [app schema](schemas/app-contract.v1.schema.json) and [public TypeScript contracts](src/contracts.ts) define the headless integration surface. Use CLI query commands for workspace discovery, topic resume, projection snapshots, receipts, and context packets. Commands accepting `--request-id` support durable retry receipts; reuse the same request ID and payload when retrying. PDF registration records source identity and anchors; highlights, comments, and reading progress occupy a separate study-state plane and do not establish concept mastery.

`project` rebuilds derived state for the supplied `--as-of` time. `schedule-review` requires a concept, due timestamp, and supporting `--reason-event` IDs. `export-gbrain` emits a promotion-candidate file with source references and qualifying evidence IDs; promotion into GBrain is a separate explicit action. The core never writes GBrain tables.

Run `gbrain-tutor --help` for command names and consult [the CLI implementation](src/cli.ts), [the skill ledger contract](skills/gbrain-tutor/references/ledger-contract.md), and [CLI acceptance tests](test/acceptance.test.ts) for executable argument examples. The [v0.2 acceptance test](test/headless-pdf-v0.2.acceptance.test.ts) exercises PDF identity, anchors, study state, retries, reviews, and export.

## PDF study workspace prototype

The separately runnable prototype renders a user-selected local PDF beside a deterministic mock tutor surface:

```bash
bun install
bun run study:dev
```

For a production-build preview:

```bash
bun run build
bun run study:preview
```

This is disposable in-memory UI state, not a live Hermes or GBrain integration. It does not read or write ledger events, projections, topic files, or promotion candidates. The future core adapter must implement the versioned [`TutorCorePort`](apps/study-workspace/src/core/tutor-core-port.ts). Boundary tests prevent the browser app from importing core filesystem or ledger internals.

## Verification

```bash
bun test
bun run typecheck
bun run lint
bun run build
bun run doctor
bun run smoke
```

The Hermes integration case is skipped when `HERMES_AGENT_PYTHONPATH` is unset. Run it against a real Hermes checkout with:

```bash
HERMES_AGENT_PYTHONPATH=/path/to/hermes-agent bun test test/hermes-skill.test.ts
```

Set `HERMES_AGENT_PYTHON` to override the default `python3` executable when needed.

The v0.1 acceptance test drives the CLI against `test/fixtures/concurrency-lecture.md` and exercises initialization, source capture, attempts and evidence, policy selection, generation-consistent projection rebuild, review scheduling, and promotion export. The v0.2 acceptance test in `test/headless-pdf-v0.2.acceptance.test.ts` drives the CLI against `test/fixtures/headless-study.pdf` for PDF registration, chapter progress and resume, independent highlights and comments across every anchor class, a confusion candidate that leaves concept state unchanged, retry-safe commands and receipts, context packet determinism, qualifying evidence, projection rebuild from an empty derived-state directory, due review completion, changed-source detection, and a non-mutating GBrain export. The Hermes test installs the complete skill into an isolated personal home, loads it through Hermes, and drives the real CLI through a historical review workflow.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the required failing-test-first workflow. Keep runtime behavior offline and deterministic, preserve accepted event history, and keep schemas, CLI behavior, and tests aligned. Linux with procfs is required for filesystem durability and containment checks. Report vulnerabilities through [SECURITY.md](SECURITY.md).

The package ships the CLI sources, schemas, workspace templates, Hermes skill, and smoke fixture through an explicit file allowlist. `bun test test/open-source-hygiene.test.ts` checks package boundaries and runs the extracted package smoke workflow. Source builds and the PDF app use the full repository checkout.
