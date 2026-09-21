# Vertical-slice TDD evidence

Development used focused behavior-first slices. The rows below record observed RED/GREEN outputs; where a later assertion expanded behavior that was already implemented, the row says so rather than claiming an independent RED. Commands ran from the repository root with Bun 1.4.2.

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
| Tutor application port | `bun test apps/study-workspace/test/tutor-core.test.ts` → `Cannot find module '../src/core/tutor-core-port.ts'`; review guard later failed because a prohibited `status` field remained | versioned port and deterministic mock context/turn response without a learning-status marker; `1 pass, 0 fail` |
| Independent annotations | `bun test apps/study-workspace/test/annotations.test.ts` → `Cannot find module '../src/annotations.ts'` | highlight and comment creation, optional reference, and independent deletion; `2 pass, 0 fail` |
| Source anchors | focused source-anchor runs first failed with a missing module, then accepted page `0`, then reported exact precision without rectangles | positive pages, cleaned quotes, page fallback, cloned normalized rectangles, and honest precision; `3 pass, 0 fail` |
| PDF page navigation | `bun test apps/study-workspace/test/navigation.test.ts` → `Cannot find module '../src/navigation.ts'`; the source-jump regression then failed because navigation helpers did not exist | bounded previous/next movement plus exact saved-anchor restoration; `2 pass, 0 fail` |
| UI/core isolation | `bun test apps/study-workspace/test/ui-boundary.test.ts` → missing `src/ui` directory; the accessibility hardening RED found no selected-state signal | recursively scanned UI modules stay inside the app boundary and mobile pane controls expose selected state; `1 pass, 0 fail` |
| PDF intake and malformed structure | `bun test apps/study-workspace/test/pdf-file.test.ts` → missing module (`0 pass, 1 fail, 1 error`); a later malformed-marker case failed (`4 pass, 1 fail, 6 expect()`) | initial intake reached `4 pass, 0 fail, 5 expect()`; structural rejection reached `5 pass, 0 fail, 6 expect()` |
| PDF.js-compatible intake | compatibility cases for a bounded preamble, header whitespace, incremental trailers, trailing bytes, and empty picker MIME produced `5 pass, 3 fail, 10 expect()` | bounded header/trailer reads accept compatible PDFs while explicit non-PDF MIME and malformed structure remain rejected; `9 pass, 0 fail, 11 expect()` |
| Tutor-session isolation and admission | the session gate initially had a missing module (`0 pass, 1 fail, 1 error`); accepted-only UI admission later produced `2 pass, 1 fail, 7 expect()` because the admission callback was not invoked | stale responses are ignored, overlapping turns are rejected, and only admitted turns may clear the draft or append the learner bubble; `3 pass, 0 fail, 8 expect()` (the overlap assertion expanded the existing gate and did not have a separate RED) |
| Source/runtime validation | invalid page totals and rectangles produced `5 pass, 2 fail, 13 expect()`; foreign-document restoration produced `3 pass, 1 fail, 13 expect()`; null/clone-hostile sources and non-array rectangles later produced `5 pass, 2 fail, 21 expect()` | runtime guards reject invalid pages, documents, clones, and rectangle payloads without throwing; final focused navigation result `7 pass, 0 fail, 25 expect()` |
| Exact source restoration | the first focused unit run failed on a missing export (`0 pass, 1 fail, 1 error`) | exact anchors restore a visible focused locator, while page-only anchors stay honest about precision; focused unit result `5 pass, 0 fail, 20 expect()` |
| Recursive production boundary guard | the first adversarial fixture was missed (`1 pass, 1 fail, 17 expect()`); JavaScript-extension coverage then failed (`2 pass, 1 fail, 19 expect()`); an internal-core fixture exposed a stale fixture inventory (`2 pass, 1 fail, 14 expect()`) | recursive lexical scanning covers the declared import/API patterns and production JavaScript extensions; `3 pass, 0 fail, 21 expect()` |
| Same-file document generation | browser acceptance failed because the successful picker retained `C:\\fakepath\\shared-mime-info-spec.pdf` | successful validation resets the picker, so choosing the same PDF creates a fresh document generation and clears the prior locator; final browser acceptance passed |
| Classic xref subsection whitespace | `bun test apps/study-workspace/test/pdf-file.test.ts` rejected subsection headers with trailing horizontal whitespace before CR, LF, and CRLF; `9 pass, 1 fail, 12 expect()` | trailing spaces and tabs are accepted without weakening the existing malformed/truncated cases; `10 pass, 0 fail, 14 expect()`; the identified 429,828-byte real PDF validated and PDF.js loaded all 7 pages |
| Bounded `startxref` candidates | an adversarial file with 300 distinct decoys was correctly rejected but caused 302 slice reads instead of the asserted maximum 130; `10 pass, 1 fail, 16 expect()` | validation checks at most 128 distinct candidates and rejects the decoys; `11 pass, 0 fail, 16 expect()` |
| Header-relative cross-reference offsets | after correcting fixtures to encode offsets relative to `%PDF-`, classic and xref-stream-like preambles plus the byte-1023 boundary were rejected; `10 pass, 4 fail, 19 expect()` | the detected header offset is applied first with absolute fallback, byte 1023 is accepted, and byte 1024 is rejected; `14 pass, 0 fail, 21 expect()` |

Current-state consolidated run on the rebased HEAD:

```text
$ bun test test apps/study-workspace/test
122 pass
0 fail
469 expect() calls
Ran 122 tests across 25 files.
```

Historical pre-rebase cycle-four totals were `113 pass, 0 fail, 383 expect()` across 19 files. Historical cycle-three totals were `110 pass, 0 fail, 378 expect()` on each of two immediate complete runs. The preceding cycle-three attempt observed the known projection concurrency flake once (`109 pass, 1 fail, 375 expect()` when one of eight writer processes exited `1`). No projection code was modified in either cycle.

Final real-browser acceptance used the local 19-page system PDF. Malformed bytes were rejected before the PDF renderer mounted; selecting the same file began a fresh document generation; desktop and 390-pixel mobile source jumps both revealed and focused the deep locator; the browser reported zero console errors.

The cycle-three browser rerun used the exact 429,828-byte review PDF: intake accepted it, PDF.js rendered all 7 pages, same-file reselection created a fresh generation, desktop and mobile deep-source restoration remained visible and focused, and the browser reported zero console errors.

Cycle-four direct validation used that same review PDF without a prefix and with 1-, 512-, and 1023-byte prefixes. The validator accepted each file and PDF.js loaded all 7 pages; the validator separately enforced the tested byte-1024 header rejection boundary. The production browser build also accepted the 512-byte-prefixed file, rendered all 7 pages, rejected malformed bytes before mounting PDF.js, reset the picker, and reported zero console errors.
