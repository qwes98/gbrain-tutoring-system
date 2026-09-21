# DeepTutor reference assessment

Research was completed on 2026-09-20 before choosing the prototype stack. This document records repository and code evidence; no DeepTutor code was copied and DeepTutor is not a dependency.

## Repository identity and license

The relevant project is [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor). Its README describes an AI tutoring system with an immersive reading workspace and shared reading/chat context ([README evidence](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/README.md#L225-L235)). The similarly named [rddy/deeptutor](https://github.com/rddy/deeptutor) describes spaced repetition through deep reinforcement learning and is not the PDF tutoring workspace intended here.

GitHub API evidence at the research date:

- Repository: `https://api.github.com/repos/HKUDS/DeepTutor`; default branch `main`.
- Inspected `main` commit: [`897fce52f24bf22e6e50d8a3e4df532632a26322`](https://github.com/HKUDS/DeepTutor/commit/897fce52f24bf22e6e50d8a3e4df532632a26322), committed 2026-09-14.
- Latest release: [`v1.6.8`](https://github.com/HKUDS/DeepTutor/releases/tag/v1.6.8), published 2026-09-14. Its annotated tag resolves to commit [`a7c30a588f883ed7d92f806c4976c05b5b8fc2e1`](https://github.com/HKUDS/DeepTutor/commit/a7c30a588f883ed7d92f806c4976c05b5b8fc2e1).
- GitHub's [license endpoint](https://api.github.com/repos/HKUDS/DeepTutor/license) reports SPDX `Apache-2.0`; the returned `LICENSE` blob SHA is `ae1dbfc5e74c6c9ebb3e46ea9ea8dde8a4a04ed8` ([license file](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/LICENSE)).

The pinned commit is used for code links below so later upstream changes cannot silently change this assessment.

## Architecture and behavior observed

### PDF rendering and source capture

DeepTutor declares `pdfjs-dist` and uses a dedicated PDF.js loader ([package](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/package.json#L35-L61), [loader](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/lib/pdfjs-loader.ts#L1-L60)). Each page renders a canvas and selectable text layer together ([page renderer](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/PdfPage.tsx#L55-L159)). The document view captures a cleaned quote, page number, page-normalized rectangles, and viewport coordinates from a browser selection ([selection capture](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/PdfDocumentView.tsx#L341-L395)); selection cleanup is isolated in testable utilities ([selection utilities](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/lib/reading-selection.ts#L1-L140)).

PDF bytes are fetched through authenticated backend APIs with range support rather than loaded from a browser `File` ([document fetch](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/PdfDocumentView.tsx#L104-L151), [API](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/lib/reading-api.ts#L349-L352)). Continuous scrolling, nearby-page rendering, and jump navigation are implemented in the PDF view ([navigation](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/PdfDocumentView.tsx#L242-L339)).

### Annotations

PDF annotations store quote and normalized rectangles in a flattened entity ([web type](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/lib/reading-api.ts#L92-L132), [backend model](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/reading/models.py#L335-L407)). An overlay reprojects normalized rectangles over rendered pages ([annotation layer](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/AnnotationLayer.tsx#L25-L106)). Creation and deletion are optimistic with rollback ([reading context](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/contexts/ReadingContext.tsx#L150-L200)).

DeepTutor does **not** implement the independent annotation contract required here. The visible annotation actions originate from a selection ([popover](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/AnnotationPopover.tsx#L97-L189)); a note is saved as the same annotation record with highlight kind ([reader pane](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReaderPane.tsx#L644-L685)). There are no separate `highlight_id` and `comment_id` relationships. Although the backend permits a page locator, the visible create flow requires selected text ([model](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/reading/models.py#L337-L343), [annotation list](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/AnnotationList.tsx#L80-L94)).

### Navigation, chat, context, and responsiveness

The reading shell combines outline, bookmarks, annotations, and sources ([workspace navigator](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReadingWorkspace.tsx#L537-L578)). It restores reading position and supports citation jumps ([reader state](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReaderPane.tsx#L254-L300), [citation navigation](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReaderPane.tsx#L487-L534)). Selected source context remains visible near the document and composer ([workspace selection](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReadingWorkspace.tsx#L629-L658), [companion](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReadingCompanion.tsx#L567-L608)). Large screens use columns; smaller screens turn the companion into an overlay ([workspace layout](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReadingWorkspace.tsx#L514-L535), [companion layout](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/components/reading/ReadingCompanion.tsx#L305-L316)).

Chat turns can carry workspace, material revision, locator, selection, and media state ([turn state](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/web/lib/reading-turn-state.ts#L22-L38), [request model](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/api/schemas/turn_request.py#L118-L165)). Reading tools resolve server-controlled material identifiers ([tools](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/reading/tools.py#L1-L60)). Its tutor behavior is an LLM/tool loop, not an offline deterministic rule policy ([reading prompt](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/prompts/en/reading.yaml#L7-L49)).

### Persistence and deployment

DeepTutor combines content-addressed files and atomic per-material JSON operations with locks ([store](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/reading/store.py#L831-L956)) plus SQLite catalog metadata ([catalog store](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/deeptutor/reading/catalog_store.py#L42-L150)). Deployment combines a FastAPI backend and Next.js frontend under Supervisord ([container architecture](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/docs/CONTAINERIZATION.md#L13-L51)). Persistent deployment mounts its full data directory ([persistence](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/docs/CONTAINERIZATION.md#L15-L21)).

## Disposition

**Mine for patterns only; do not adopt or fork.**

Reusable patterns are the direct PDF.js canvas/text-layer pairing, page-normalized selection rectangles, persistent visible source context, citation-to-document navigation, optimistic disposable UI state, and responsive companion treatment. The prototype independently applies those ideas through its own small application port.

Adoption or a fork would bring backend authentication, SQLite/catalog assumptions, server-owned material IDs, an LLM tool loop, and a multi-service deployment into a repository whose core must remain deterministic and offline. DeepTutor's combined note/highlight entity also conflicts with this prototype's independent highlight and comment lifecycle. The upstream project is moving quickly, and its README warns that some screenshots lag the current UI ([README note](https://github.com/HKUDS/DeepTutor/blob/897fce52f24bf22e6e50d8a3e4df532632a26322/README.md#L616-L626)).

Features not found in the inspected revision are browser-local PDF `File` loading, independent highlights and comments with optional references, independent deletion semantics, a visible page-only comment flow, a versioned tutor-core application port, a deterministic mock fixture, and explicit GBrain ledger/projection boundaries.
