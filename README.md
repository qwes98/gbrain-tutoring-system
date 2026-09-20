# GBrain Tutoring System v0.2

A deterministic, offline tutoring ledger with append-only events, replayable projections, an inspectable rule policy, a Bun CLI, and a personal-installable Hermes skill. v0.2 adds an app-facing headless contract: versioned schemas and public types, query commands that never require parsing internal projection files, retry-safe commands with durable receipts, structured PDF identity and source anchors, a separate study-state plane, and a deterministic bounded context packet. GBrain integration stops at an explicit promotion-candidate file; this project never mutates GBrain automatically.

## Install

Requires Linux with procfs and Bun 1.3 or newer. Storage mutations fail closed when descriptor-anchored procfs paths are unavailable.

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
  --title "Concurrency Control" --source ./notes/concurrency.md

TOPIC=./tutoring-ledger/topics/concurrency
gbrain-tutor record concept "$TOPIC" \
  --concept locks --title "Mutual exclusion" \
  --source-ref sources/concurrency.md#locks --at 2026-01-01T00:00:00Z
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

See [CLI reference](docs/cli.md), [architecture and event model](docs/architecture.md), [GBrain boundary](docs/gbrain-integration.md), and the [design-only PDF study workspace requirements](docs/study-workspace/README.md).

## Verification

```bash
bun test
bun run typecheck
bun run lint
bun run build
bun run doctor
bun run smoke
```

The v0.1 acceptance test drives the CLI against `test/fixtures/concurrency-lecture.md` and exercises initialization, source capture, attempts and evidence, policy selection, generation-consistent projection rebuild, review scheduling, and promotion export. The v0.2 acceptance test in `test/headless-pdf-v0.2.acceptance.test.ts` drives the CLI against `test/fixtures/headless-study.pdf` for PDF registration, chapter progress and resume, independent highlights and comments across every anchor class, a confusion candidate that leaves concept state unchanged, retry-safe commands and receipts, context packet determinism, qualifying evidence, projection rebuild from an empty derived-state directory, due review completion, changed-source detection, and a non-mutating GBrain export. The Hermes test installs the complete skill into an isolated personal home, loads it through Hermes, and drives the real CLI through a historical review workflow.
