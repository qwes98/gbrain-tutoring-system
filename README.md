# GBrain Tutoring System v0.1

A deterministic, offline tutoring ledger with append-only events, replayable projections, an inspectable rule policy, a Bun CLI, and a personal-installable Hermes skill. GBrain integration stops at an explicit promotion-candidate file; this project never mutates GBrain automatically.

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

The acceptance test drives the CLI against `test/fixtures/concurrency-lecture.md` and exercises initialization, source capture, attempts and evidence, policy selection, generation-consistent projection rebuild, review scheduling, and promotion export. The Hermes test installs the complete skill into an isolated personal home, loads it through Hermes, and drives the real CLI through a historical review workflow.
