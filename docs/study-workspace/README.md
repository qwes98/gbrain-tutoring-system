# PDF study workspace

**Delivery status: isolated disposable prototype.** The separately runnable app in `apps/study-workspace` proves local PDF rendering, selection/source capture, independent annotations, responsive document/tutor navigation, and an application-facing tutor port. It does not change the product requirements or claim a production integration.

The desktop layout places a selectable PDF workspace beside a tutor conversation. Narrow screens use explicit Document and Tutor tabs. PDF bytes stay in the browser session, and all annotations and messages are in memory.

## Run

From the repository root:

```bash
bun install
bun run study:dev
```

Open the Vite URL, choose a local PDF, and select text in its rendered text layer. To exercise the production build:

```bash
bun run build
bun run study:preview
```

App-specific commands are also available:

```bash
bun run --cwd apps/study-workspace test
bun run --cwd apps/study-workspace typecheck
bun run --cwd apps/study-workspace lint
bun run --cwd apps/study-workspace build
```

## Boundaries

- Vite, React, and React-PDF are the thinnest maintainable isolated stack here: the repository has no existing browser application to extend, while the DeepTutor reference confirms PDF.js canvas/text-layer behavior without justifying its backend and deployment surface. React-PDF packages that PDF.js behavior without coupling the headless root `src/` core to UI code.
- `TutorCorePort` is versioned as `gbrain-tutor-core/v1`; `MockTutorCore` is deterministic fixture behavior, not a live Hermes transport.
- UI modules do not import the root ledger, projections, topic internals, `events.jsonl`, or projection-generation files.
- The future `GBrainTutorCore` adapter belongs behind `TutorCorePort`. It will translate stable application DTOs to approved core contracts at the composition boundary; replacing the adapter must not require UI imports from core internals.
- Annotation state is explicitly disposable. The prototype does not invent a ledger event, projection, persistence, synchronization, or migration schema.
- Source anchors are prototype values: document fingerprint, one-based page, cleaned quote, and page-normalized selection rectangles when the browser exposes them.
- PDF rendering uses PDF.js through React-PDF. Complex forms, encrypted documents, nonstandard fonts, accessibility remediation, and durable annotation overlays remain outside this slice.
- The production build currently reports Vite's non-blocking chunk-size warning because the PDF.js runtime and worker are substantial. The prototype keeps them local and separate from the headless core; bundle optimization is deferred until the application boundary is approved.

## Documents

- [Product requirements](requirements.md) — goals, user journey, functional behavior, learner-model rules, scope, and observable acceptance criteria.
- [DeepTutor reference assessment](deeptutor-reference.md) — pinned repository evidence, license, reusable patterns, gaps, risks, and disposition.
