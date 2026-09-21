# Contributing

Thank you for helping improve GBrain Tutoring System.

## Development setup

Development requires Linux with procfs, Bun 1.3 or newer, Bash, and `strace`. Python 3 is needed only for the optional Hermes integration test.

```bash
bun install
bun run doctor
```

## Making changes

- Keep the core deterministic and offline.
- Preserve the append-only ledger: represent corrections as new events.
- Cite evidence event IDs for every derived concept-state change.
- Write documentation, code comments, and commit messages in English.
- Do not add credentials, secrets, or machine-specific absolute paths.
- Use focused vertical-slice TDD: observe a failing behavior test, implement the minimum change, and rerun it before continuing.

## Verification

Run the complete local verification suite before opening a pull request:

```bash
bun test
bun run typecheck
bun run lint
bun run build
bun run doctor
bun run smoke
```

The Hermes integration case skips cleanly by default. To run it against a real local Hermes checkout:

```bash
HERMES_AGENT_PYTHONPATH=/path/to/hermes-agent bun test test/hermes-skill.test.ts
```

Include tests for behavior changes and describe any platform-specific verification gaps in the pull request.

## Reporting security issues

Follow [SECURITY.md](SECURITY.md) rather than opening a public issue for a suspected vulnerability.
