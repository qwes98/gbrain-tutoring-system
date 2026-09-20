# Vertical-slice TDD evidence

Each behavior was introduced by a focused test, executed to observe the expected failure, implemented minimally, and rerun before the next slice. Commands ran from the repository root with Bun 1.4.2.

| Slice | RED command and observed failure | GREEN result |
| --- | --- | --- |
| Workspace generator | `bun test test/workspace.test.ts` → `Cannot find module '../src/workspace.ts'` | `1 pass, 0 fail`; later overwrite-safety RED showed the operator config was replaced, then `2 pass, 0 fail` |
| Schema validation | `bun test test/schema-ledger.test.ts` → `Cannot find module '../src/schema.ts'` | invalid timestamp and boolean rejected; `1 pass, 0 fail` |
| Append and duplicate IDs | same focused file → `appendEvent is not implemented` | validated append plus duplicate rejection; `2 pass, 0 fail` |
| Truncated tail semantics | `bun test test/ledger-recovery.test.ts` → expected recovered tail text, received `undefined` | strict failure and explicit tail recovery; `1 pass, 0 fail` |
| Concurrent append | `bun test test/ledger-concurrency.test.ts` → six worker exits were `1` before the worker interface existed | six processes, 120 unique events; `1 pass, 0 fail` |
| Deterministic replay | `bun test test/projection.test.ts` → `Cannot find module '../src/projection.ts'` | byte-stable ordered replay; `1 pass, 0 fail` |
| Assistance and promotion evidence | same focused file → qualifying evidence was `undefined` | assisted evidence separated; two unassisted distinct questions qualify |
| Misconception and review provenance | same focused file → concept `state_history` was `undefined` | open misconception, delayed review, and cited state changes |
| Append-only correction replay | same focused file → `applied_corrections` was `undefined` | original history retained and correction provenance exposed |
| Due-review policy | `bun test test/policy.test.ts` → `Cannot find module '../src/policy.ts'` | one due review selected with reason codes |
| Evidence and assistance rules | successive focused runs → `no policy rule matched topic state` for evidence, hint, explanation, and scheduling cases | evidence-before-explanation, minimal hint, bounded escalation, and delayed review all pass |
| CLI acceptance | `bun test test/acceptance.test.ts` → `Module not found .../src/cli.ts` | full local-source workflow; `1 pass, 0 fail` |
| Hermes skill | `bun test test/hermes-skill.test.ts` → `ENOENT .../skills/gbrain-tutor/SKILL.md` | portable skill contract; `1 pass, 0 fail` |
| Temporal and lifecycle audit | focused projection/policy/ledger run → future correction leaked, review queue stayed at length `1`, domain-invalid append resolved, stable evidence cited one question twice, and review `due_at` was `undefined` | as-of cutoff, retired reviews, pre-append domain validation, distinct-question citations, and deterministic due date pass |
| Executable skill context | acceptance run → `next.context` was `undefined` | `next` returns selected concept/question context and source references |
| Dependency time and topic integrity | focused ledger run → a backdated dependent attempt and a cross-topic correction both resolved instead of rejecting | dependency timestamps and single-topic correction checks reject both before durable append while independent concurrent events may arrive out of timestamp order |
| Resolution provenance | focused projection run → a second resolution did not throw | duplicate resolution is rejected so the first state-changing event remains authoritative |
| 1. Bounded hint escalation | `bun test test/policy.test.ts` → `6 pass, 1 fail`; expected `explain_bottleneck`, received repeated `give_hint` | one recorded hint for the current attempt escalates with attempt and action evidence; final policy suite `8 pass, 0 fail` |
| 2. Strict RFC 3339 | focused schema run → `0 pass, 1 fail`; `2026-02-30` was accepted | nonexistent dates and `24:00` rejected; focused GREEN `1 pass, 0 fail, 4 expect()` |
| 3. Historical Hermes review time | installed-skill test → `1 pass, 1 fail`; loaded prompt lacked the decision due-time and historical `--at` command | skill carries `TURN_TIME`, `decision.due_at`, concept, and every reason ID; Hermes suite `2 pass, 0 fail` |
| 4. Installed Hermes/CLI path | new isolated-home acceptance initially exposed the incomplete installed procedure above | copied personal skill loads through native Hermes and drives a real CLI topic through `next` and historical review append |
| 5. Ownership-safe stale reclaim | combined storage RED → old singleton reclaim lacked a safe interleaving surface | immutable per-owner bakery tickets survive forced replacement/publication interleavings; reused PID identity is reclaimed |
| 6. Symlink containment | combined storage RED → workspace, topic, ledger, and atomic writes followed managed-path symlinks | lexical/canonical checks reject target and ancestor symlinks before writes; workspace suite `8 pass, 0 fail` |
| 7. Ledger directory durability | `strace` regression did not observe parent-directory `fsync` for new ledger creation | file and parent directory fsyncs observed; durability test GREEN |
| 8. UTF-8 and blank JSONL | focused recovery RED accepted invalid bytes and skipped interior blank records | fatal UTF-8 decoding and blank-record rejection; recovery suite `4 pass, 0 fail` |
| 9. Due instant ordering | policy run → `7 pass, 1 fail`; lexical order selected concept `b` instead of earlier instant `a`; projection regression likewise returned `[b, a]` | policy selection and projected queues use parsed epoch ordering with deterministic tie-breaks |
| 10. Correction precedence | projection RED selected appended-last older correction; reverse equal-time order produced divergent state | latest parsed instant wins with greatest event ID tie-break; focused projection suite GREEN |
| 11. Action-specific schema | focused schema run → `0 pass, 1 fail`; missing action fields were accepted | question actions require concept/question; review scheduling requires concept/due time; `1 pass, 0 fail, 9 expect()` |
| 12. Projection generation consistency | projection RED had missing manifest, exposed interrupted publication, and eight writer exits before the fixture existed | content-addressed generations plus atomic current manifest survive forced exit and eight concurrent writers |
| Projection timestamp integration | focused projection RED accepted invalid `as_of` values | shared strict RFC 3339 validator rejects nonexistent projection timestamps; `1 pass, 0 fail` |
| Review/action integration | focused projection RED scheduled a review without any question that a due action could cite | candidate replay rejects questionless review schedules before durable append; `1 pass, 0 fail` |
| Historical correction cutoff audit | focused schema/ledger RED appended an older invalid correction because only the latest replay cutoff was checked | correction appends also validate replay at the correction instant; `1 pass, 0 fail, 2 expect()` |
| Intermediate correction cutoff audit | focused schema/ledger RED accepted an older correction that conflicted at an intervening event instant but was masked by a newer correction | correction candidates validate every distinct affected event instant; `1 pass, 0 fail, 2 expect()` |
| Closed tutor-action shapes | focused schema RED accepted concept data on `complete`, review data on `give_hint`, and question data on `schedule_review` | mutually exclusive action schemas reject inappropriate fields; `1 pass, 0 fail, 3 expect()` |
| Tutor-action relationship integrity | focused projection RED accepted a question from a different concept | replay requires each question action's question to belong to its cited concept; `1 pass, 0 fail` |
| Delayed action scheduling | focused projection RED accepted a `schedule_review` action whose due instant equaled the action instant | replay requires the scheduled due instant to be strictly later; `1 pass, 0 fail` |
| Exact fractional instant ordering | focused projection/policy RED treated `.0001Z` and `.0002Z` as the same millisecond, selecting the wrong correction and due review | exact arbitrary-precision RFC 3339 comparison governs cutoffs, correction precedence, dependencies, review status, and policy order; `2 pass, 0 fail, 6 expect()` |

Final consolidated run:

```text
$ bun test
60 pass
0 fail
185 expect() calls
Ran 60 tests across 10 files.
```
