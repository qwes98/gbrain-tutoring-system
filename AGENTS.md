# GBrain Tutoring System

Build an executable, file-first learning ledger and rule-based tutor policy that integrates with GBrain and can be driven by a Hermes skill.

## Required workflow

- Use strict vertical-slice TDD: write one failing behavior test, run it and observe the expected failure, implement the minimum behavior, rerun, then continue.
- Before designing adapters, inspect `../gbrain` for proven patterns in CLI structure, atomic writes, append-only logs, schemas, provenance, projections, and tests. Reuse principles, not private implementation details.
- Keep the core deterministic and offline. LLMs may execute the policy but must not be required to validate, append, replay, or project ledger state.
- Do not add learner-directed comments or learning-status markers to product code or commit messages.
- Preserve append-only event history. Corrections are new events, never rewrites.
- Every derived concept-state change must cite evidence event IDs.
- Do not add GBrain core tables in v0.1. Integrate through files and explicit GBrain export/promotion boundaries.
- Never store credentials or secrets.

## Required deliverables

1. Repository and topic workspace generator.
2. JSON Schema-based ledger event validation.
3. Concurrency-safe append-only event writer.
4. Deterministic projection builder.
5. Rule-based tutor policy with inspectable reasons.
6. Hermes tutoring skill and CLI-facing execution interface.
7. End-to-end acceptance test using a real local learning source fixture.

## Verification

Before completion, run the full unit/integration test suite, typecheck/lint/build if configured, and at least one real CLI smoke workflow that initializes a topic, records attempts/evidence, selects a tutor action, rebuilds projections, schedules a review, and exports a stable GBrain promotion candidate.
