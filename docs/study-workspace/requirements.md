# PDF study workspace requirements

## Delivery status

**Design-only.** This document defines product requirements and observable behavior. It does not select or specify a UI framework, backend, data schema, dependency set, integration protocol, deployment model, or detailed technical architecture.

## Product definition

The PDF study workspace is a purpose-built learning client and runtime for the existing GBrain tutoring system. It combines a PDF reading surface on the left with a Hermes tutoring conversation on the right. It supports sequential chapter study, exact references back to source material, durable learner annotations, and questions that are aware of the learner's current source context.

The workspace uses the existing learning ledger and rule-based tutor policy as its learning-state and action-selection boundary. It does not replace those components or make an LLM responsible for validating, appending, replaying, or projecting ledger state.

## Goals

- Keep focused reading and tutoring in one study surface without losing the learner's place.
- Guide a learner through a PDF sequentially by chapter while allowing deliberate navigation and resumption.
- Let the learner highlight source material and write comments as separate, durable actions.
- Ground tutoring exchanges in exact source locations and clearly identify the context used for an answer.
- Keep source progress, learner-authored annotations, and assessed learning evidence separate.
- Feed legitimate learner evidence into the existing deterministic ledger and rule-based tutor policy.
- Preserve an explicit, reviewable boundary before any learning result becomes a GBrain promotion candidate.

## Product boundaries and principles

- The learning ledger remains append-only. Corrections are represented by later events rather than historical rewrites.
- Ledger validation, append, replay, projection, and policy evaluation remain deterministic and available offline.
- Every derived concept-state change cites the learner-evidence event IDs that support it.
- Source progress records where the learner has read; it does not assert what the learner knows.
- Highlights and comments are annotations, not learning evidence by themselves.
- GBrain integration remains file-based and explicit. The workspace may prepare a promotion candidate, but it never mutates GBrain automatically.
- Credentials and secrets are never stored in the study workspace.

## Primary user journey

1. The learner creates or opens a study workspace for a PDF and sees the document beside a Hermes conversation.
2. The workspace identifies the current chapter and restores the learner's last durable reading position, chapter progress, annotations, and relevant tutoring context.
3. The learner studies the current chapter in sequence, with the option to navigate elsewhere without falsely marking skipped material as studied.
4. The learner may highlight selected text, add a comment to selected text or another page context, or do both independently.
5. The learner asks a question. The workspace supplies Hermes with the relevant, bounded PDF context and exact source anchors, along with applicable learning context from the existing ledger and tutor policy.
6. Hermes answers with references the learner can use to return to the supporting source location. If the learner's comment expresses confusion, the workspace may open a question or misconception candidate for later resolution.
7. Assessed learner activity, such as an answer to a tutor question, may produce ledger evidence. Only qualifying learner evidence may change projected concept state.
8. The learner closes and later reopens the workspace, resumes in place, and continues the same chapter-oriented study flow.
9. When the existing policy and evidence support promotion, the learner can explicitly export a stable GBrain promotion candidate for review; no automatic GBrain mutation occurs.

## Functional requirements

### Study workspace and navigation

- **FR-1:** The workspace shall present the active PDF on the left and the active Hermes tutoring conversation on the right within one study experience.
- **FR-2:** The workspace shall organize study around an ordered chapter sequence derived from or associated with the PDF.
- **FR-3:** The learner shall be able to move between chapters and pages while the workspace retains an explicit current chapter and reading position.
- **FR-4:** The workspace shall distinguish material visited, material completed in the source sequence, and material not yet studied without interpreting any of those states as mastery.
- **FR-5:** Skipping ahead or revisiting an earlier page shall not silently complete intervening chapters or create learning evidence.

### Source anchoring

- **FR-6:** Any tutor response, annotation, question context, or learner-evidence record that refers to the PDF shall carry an anchor precise enough to return the learner to the intended source context.
- **FR-7:** An anchor shall identify the document and page and, when applicable, the selected text or page region. The exact representation is deferred to detailed design.
- **FR-8:** When exact anchoring is unavailable or ambiguous, the workspace shall disclose that limitation instead of presenting an approximate location as exact.
- **FR-9:** A learner shall be able to navigate from a displayed source reference to the referenced PDF context.

### Highlights and comments

- **FR-10:** A learner shall be able to create a highlight from selected PDF text without creating or supplying a comment.
- **FR-11:** A learner shall be able to create a comment without creating a highlight. A comment may be independently anchored to selected text, a page location or region, or page-level context.
- **FR-12:** A highlight and a comment may point to the same source anchor, but neither annotation owns the other.
- **FR-13:** Deleting a highlight shall not delete a comment, including a comment at the same source anchor.
- **FR-14:** Deleting a comment shall not delete a highlight, including a highlight at the same source anchor.
- **FR-15:** The learner shall be able to review, navigate to, and delete each annotation independently.
- **FR-16:** Persisted annotations shall retain enough source identity and location context to be restored after the workspace is reopened.

### Hermes tutoring conversation

- **FR-17:** The learner shall be able to ask Hermes a question about the current PDF context without manually reproducing the relevant passage or location.
- **FR-18:** The learner shall be able to explicitly ask about another selected or anchored part of the PDF.
- **FR-19:** The conversation shall distinguish source content, learner-authored comments, source progress, and ledger-derived learning state.
- **FR-20:** Tutor actions shall continue to follow the existing rule-based policy and expose inspectable reasons where that policy selects the next action.
- **FR-21:** Answers grounded in the PDF shall expose usable source references. The workspace shall not invent a source anchor for unsupported content.

### Progress and learning evidence

- **FR-22:** Source progress shall be persisted separately from ledger evidence and projected concept state.
- **FR-23:** Creating, editing, viewing, or deleting a highlight or comment shall not by itself create mastery evidence or change concept state.
- **FR-24:** A comment that expresses confusion may open a question or misconception candidate, but the comment alone shall not establish that a misconception exists or alter mastery.
- **FR-25:** A question or misconception candidate opened from a comment shall remain traceable to that comment and its source anchor without making either artifact own the other.
- **FR-26:** A concept-state change shall require later qualifying learner evidence under the existing ledger and policy rules and shall cite the supporting evidence event IDs.
- **FR-27:** The workspace shall preserve the distinction between assisted and unassisted learner performance already enforced by the existing projection rules.

## Context assembly behavior

When preparing context for a Hermes turn, the workspace shall:

- start from the learner's explicit question and any explicit text selection or annotation reference;
- include a bounded amount of relevant source content from the current page or chapter rather than treating the entire PDF as implicit context;
- preserve exact anchors for quoted or summarized source content;
- label source content, learner comments, reading progress, prior conversation, ledger evidence, and projected learning state by their role so they cannot be mistaken for one another;
- include only the prior annotations and tutoring history relevant to the current question;
- respect the existing tutor policy's selected action and inspectable reasons when the exchange is policy-directed;
- avoid treating reading position, a highlight, a comment, or an unassessed conversation turn as proof of understanding;
- disclose when requested source content cannot be read, anchored, or included; and
- produce the same ledger-relevant result from the same validated evidence and policy inputs, independent of nondeterministic conversational wording.

The workspace may use a model to conduct the conversation, but correctness of ledger operations and concept-state projection shall not depend on model output.

## Learner-model update rules

- Reading or scrolling updates source progress only.
- A highlight records learner-selected source attention only.
- A comment records learner-authored annotation only.
- A comment expressing uncertainty or a possible misunderstanding may create a question or misconception candidate for follow-up.
- Opening a candidate does not establish a concept-state change.
- A learner question and a tutor explanation do not by themselves demonstrate mastery.
- Only later, qualifying learner evidence accepted under the ledger's deterministic rules may update concept state.
- Every derived concept-state transition shall retain provenance to the supporting learner-evidence event IDs.
- Corrections append new ledger history; they never rewrite existing evidence.

## Persistence and resume

- The workspace shall persist the PDF's identity, current chapter, current page or reading position, source progress, highlights, comments, and enough conversation state to resume coherent study.
- Resume shall restore annotations independently, including highlights without comments and comments without highlights.
- Resume shall preserve the separation among source progress, annotations, ledger events, disposable projections, and GBrain promotion candidates.
- A projection may be rebuilt from validated ledger history without relying on previously generated projection files or conversational memory.
- Missing, moved, or changed source material shall be reported to the learner; the workspace shall not silently attach existing annotations or evidence to a different source.
- Persisted state shall survive normal application closure without requiring network access.

## Privacy and security

- PDF reading, local annotation, source-progress persistence, ledger, projection, and policy workflows shall remain usable offline. Whether a Hermes conversation can operate offline depends on the transport selected during detailed design.
- The workspace shall minimize PDF excerpts, comments, and learning context sent outside the local environment.
- Any operation that transmits source content or learner data outside the local environment shall be visible to the learner and governed by an explicit configured boundary.
- The workspace shall not store credentials or secrets in project files, annotations, ledger events, logs, exports, or promotion candidates.
- Diagnostic output shall avoid exposing unnecessary PDF content, learner comments, or conversation text.
- GBrain receives nothing automatically; promotion remains an explicit export and review action.

## MVP scope

The MVP includes:

- one learner working in a local study workspace;
- one active PDF per topic workspace;
- a two-surface PDF and Hermes study experience;
- sequential chapter navigation and durable source progress;
- exact source references where the PDF supplies sufficient location information;
- independent creation, persistence, navigation, and deletion of highlights and comments;
- comments anchored to selected text, a page location or region, or page-level context;
- context-aware questions and source-grounded tutor responses;
- integration with the existing ledger, deterministic projections, and rule-based tutor policy;
- persistence and resume across normal closures; and
- explicit export of a stable GBrain promotion candidate.

## Non-goals

- Replacing the existing ledger, projection builder, or tutor policy.
- Automatic or direct mutation of GBrain.
- Treating reading progress, highlights, comments, or tutor explanations as mastery evidence.
- Multi-user collaboration, shared annotation, classroom administration, or instructor dashboards.
- General-purpose PDF editing or document-authoring features.
- Automatic completion of skipped chapters.
- Cloud synchronization or cross-device synchronization as a requirement for the initial workspace.
- Finalizing UI, backend, schemas, dependencies, APIs, deployment, or other detailed technical architecture in this phase.

## Observable acceptance criteria

- **AC-1:** Given a configured PDF, opening the workspace shows the PDF on the left and a Hermes conversation on the right.
- **AC-2:** Given an in-progress chapter, closing and reopening the workspace restores the same document, chapter, reading position, source progress, annotations, and usable tutoring context.
- **AC-3:** Navigating ahead and back changes reading position without creating mastery evidence or silently completing skipped chapters.
- **AC-4:** A learner can create a highlight with no comment, reopen the workspace, and navigate from that highlight to its source text.
- **AC-5:** A learner can create a comment with no highlight at each supported anchor class—selected text, a page location or region, and page-level context—and restore it after reopening.
- **AC-6:** A highlight and comment can share the same source anchor; deleting either leaves the other present and usable.
- **AC-7:** Asking about selected or current source context produces an answer with a source reference that returns to the cited location, or clearly reports that exact anchoring is unavailable.
- **AC-8:** The context supplied for a tutoring turn identifies source excerpts, learner comments, progress, conversation, and learning evidence as distinct categories.
- **AC-9:** Adding a highlight or a neutral comment leaves projected concept state unchanged.
- **AC-10:** Adding a confusion comment may create a traceable question or misconception candidate, but projected concept state remains unchanged until qualifying learner evidence is recorded.
- **AC-11:** When qualifying learner evidence changes a concept state, the resulting state cites the supporting evidence event IDs and can be reproduced by deterministic replay.
- **AC-12:** Core study-state validation, ledger append, replay, projection, and policy selection succeed without network access or an LLM.
- **AC-13:** A policy-directed tutoring turn exposes the policy's reason codes and relevant evidence event IDs.
- **AC-14:** A GBrain promotion candidate appears only after an explicit export action, and GBrain itself is not mutated.
- **AC-15:** No persisted workspace file or diagnostic output contains credentials or secrets.

## Decisions deferred to detailed design

The following decisions are intentionally unresolved until a detailed design phase:

- standalone application versus Hermes Desktop plugin;
- PDF rendering stack;
- Hermes transport and API boundary;
- annotation storage schema;
- OCR scope and provider;
- retrieval and ranking strategy for source context; and
- deployment topology.

Detailed design must preserve the requirements above, especially annotation independence, evidence provenance, deterministic offline ledger behavior, and explicit GBrain promotion.
