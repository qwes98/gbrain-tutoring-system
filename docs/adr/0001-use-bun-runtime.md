# ADR 0001: Use Bun as the primary runtime

- **Status:** Accepted
- **Date:** 2026-09-21

## Context

GBrain Tutoring System is a small offline-first TypeScript CLI whose correctness depends on append-only logs, deterministic replay, cross-process locking, crash-safe publication, and real command-line acceptance tests. The project also follows implementation patterns already proven in the upstream GBrain workspace.

The repository previously used Bun throughout the code and scripts, but the decision and its trade-offs were not recorded in a repository-local ADR.

## Decision

Use **Bun 1.3 or newer** as the primary execution runtime and integrated development tool for the CLI.

Bun owns:

- direct TypeScript CLI execution;
- dependency installation and local binary linking;
- unit and integration test execution;
- development and verification scripts;
- production CLI bundling;
- the FFI boundary used by the Linux file-safety implementation.

This is a runtime decision, not only a package-manager preference. The current implementation is not expected to run unchanged under Node.js.

## Rationale

### Reuse the proven GBrain toolchain

The project was required to inspect GBrain's command structure, append-only storage, atomic writes, schemas, provenance, projections, and tests before designing its own core. Keeping Bun and TypeScript preserves a shared implementation and operating model without copying private modules.

### Keep the TypeScript CLI toolchain small

Bun provides the runtime, package manager, test runner, script runner, and bundler used by this repository. A Node.js implementation could satisfy the same product requirements, but it would require additional choices and configuration for TypeScript execution, testing, and bundling.

### Support the current file-safety model

The storage implementation uses `bun:ffi` to call Linux system facilities required by the current safety design, including:

- `flock` for cross-process locking on the ledger inode;
- `linkat` for descriptor-anchored publication;
- `renameat2` for atomic replacement.

A Node.js port would need an equivalent native layer or another implementation that preserves the same observable guarantees.

### Retain access to the Node.js package ecosystem

Bun implements common Node.js APIs and package-resolution behavior, allowing the project to use much of the existing JavaScript and TypeScript ecosystem. This compatibility is useful but not assumed to be complete: Node ABI dependencies, native addons, V8-specific behavior, and tools that invoke the `node` binary require explicit verification.

Bun speed was not established as the deciding factor and is not part of this ADR's justification.

## Consequences

- Supported environments must be able to install and run a compatible Bun release.
- Linux procfs and the current Bun FFI behavior are part of the operational compatibility boundary.
- Bun upgrades must run the full concurrency, crash-safety, atomic-publication, CLI, and acceptance suites.
- Dependencies must be tested under Bun rather than assumed compatible because they support Node.js.
- A future Node.js or other-runtime port is possible, but it is an engineering migration rather than a command substitution.

## Requirements for a runtime migration

A replacement runtime must:

1. replace `bun:ffi` use for `flock`, `linkat`, and `renameat2` with an equivalent native boundary;
2. replace Bun-specific process and timing APIs;
3. provide a verified TypeScript execution, test, and build toolchain;
4. preserve ledger concurrency, crash safety, descriptor-anchored mutation, and atomic publication under acceptance tests;
5. preserve installation, binary linking, and Hermes skill execution workflows.

## Revisit when

Re-evaluate this decision if:

- a required deployment environment cannot run Bun reliably;
- an essential dependency remains incompatible with Bun and replacement cost becomes material;
- Bun regressions repeatedly threaten ledger safety or CLI reliability;
- another runtime can preserve the current kernel-lock and atomic-publication guarantees with a materially simpler standard interface;
- GBrain moves to another runtime and the shared toolchain advantage disappears.

## Evidence

- `package.json`
- `src/cli.ts`
- `src/ledger.ts`
- `src/atomic-file.ts`
- `docs/architecture.md`
- `AGENTS.md`
