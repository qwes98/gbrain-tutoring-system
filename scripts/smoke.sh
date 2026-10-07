#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
smoke_root="$(mktemp -d -t gbrain-tutor-smoke.XXXXXX)"
trap 'rm -rf -- "$smoke_root"' EXIT
workspace="$smoke_root/workspace"
topic="$workspace/topics/concurrency"
cli=(bun "$repo_root/src/cli.ts")
at_base="2026-01-01T00:00:00.000Z"

"${cli[@]}" init "$workspace" >/dev/null
"${cli[@]}" topic init "$workspace" concurrency --title "Concurrency Control" --source "$repo_root/test/fixtures/concurrency-lecture.md" >/dev/null
"${cli[@]}" record concept "$topic" --id c-append --concept append --title "Append-only logs" --source-ref sources/concurrency-lecture.md --at "$at_base" >/dev/null
"${cli[@]}" record evidence "$topic" --id e-source --concept append --kind source --summary "Corrections append records." --source-ref sources/concurrency-lecture.md --at 2026-01-01T00:01:00.000Z >/dev/null
"${cli[@]}" record question "$topic" --id q1-event --question q1 --concept append --prompt "How are corrections represented?" --source-ref sources/concurrency-lecture.md --at 2026-01-01T00:02:00.000Z >/dev/null
"${cli[@]}" record attempt "$topic" --id a1 --question q1 --concept append --answer "A new event" --correct true --assistance none --at 2026-01-01T00:03:00.000Z >/dev/null
"${cli[@]}" record question "$topic" --id q2-event --question q2 --concept append --prompt "What terminates a JSONL record?" --source-ref sources/concurrency-lecture.md --at 2026-01-01T00:04:00.000Z >/dev/null
"${cli[@]}" record attempt "$topic" --id a2 --question q2 --concept append --answer "A newline" --correct true --assistance none --at 2026-01-01T00:05:00.000Z >/dev/null
"${cli[@]}" next "$topic" --id action-1 --at 2026-01-01T00:06:00.000Z >/dev/null
"${cli[@]}" schedule-review "$topic" --id review-1 --concept append --due 2026-01-04T00:06:00.000Z --reason-event a1 --reason-event a2 --at 2026-01-01T00:07:00.000Z >/dev/null
"${cli[@]}" project "$topic" --as-of 2026-01-02T00:00:00.000Z >/dev/null
"${cli[@]}" export-gbrain "$topic" --as-of 2026-01-02T00:00:00.000Z
