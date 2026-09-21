# Learning model and storage boundaries

This document is the repository-canonical description of the learning model that constrains GBrain Tutoring System behavior. Concrete schemas, commands, and implemented state transitions remain authoritative in the checked-in schemas, tests, and architecture documentation.

## Project model

The system separates three responsibilities:

1. **GBrain — knowledge and provenance.** Stores source material, stable concepts, durable facts and takes, project relationships, and explicitly reviewed promotion results.
2. **Learning ledger — learner state and evidence.** Stores what the learner attempted, what help was used, what failed, what evidence was produced, and what must be reviewed later.
3. **Tutor policy — next-action selection.** Reads validated learning state and selects one inspectable next action without making an LLM responsible for ledger correctness.

```text
GBrain = what knowledge is worth retaining
Learning ledger = what the learner has demonstrated
Tutor policy = what the learner should do next
```

GBrain is not a session-log or mastery-state database. The ledger does not replace GBrain's source and knowledge graph. The tutor policy does not rewrite either one.

## Observable learning, not consumption

Progress is measured through capability and evidence rather than completed material.

Strong evidence can include:

- explaining a causal mechanism in the learner's own words;
- predicting an outcome before execution;
- applying a principle under changed conditions;
- diagnosing the cause and boundary of a failure;
- reconstructing a system without a worked solution;
- transferring an idea to an unfamiliar problem;
- reproducing the capability after a delay.

The following are not mastery evidence by themselves:

- reading a chapter or watching a lecture;
- scrolling or marking source progress;
- creating a highlight or comment;
- generating a summary or concept page;
- receiving a tutor explanation;
- running code whose learner-owned causal core was produced by an AI.

A correct attempt with substantial assistance is not equivalent to an independent attempt. Repeating the same problem is not transfer evidence.

## Preserve the formation of understanding

The system preserves the path from source to stable concept instead of storing only the final summary.

```text
source anchor
→ observation
→ question or prediction
→ attempt
→ result
→ misconception revision
→ qualifying evidence
→ stable concept candidate
```

Questions do not close merely because an answer was shown. Misconceptions are revised by later evidence rather than erased. Corrections append history rather than rewriting earlier events.

Source progress, annotations, conversation, learner evidence, and projected concept state remain separate domains. A failure to extract or anchor source content must not be recorded as a learner capability failure.

## Tutor policy principles

The policy should:

1. reveal the learner's current model before explaining;
2. activate one learning bottleneck at a time;
3. prefer observable prediction, explanation, application, or debugging tasks;
4. classify failure before choosing help;
5. escalate from the smallest useful hint;
6. distinguish assisted success from independent success;
7. test the boundary of a first success with a variation, counterexample, transfer task, or delayed review;
8. change projected state only from qualifying evidence;
9. preserve repeated causal errors as misconception candidates;
10. end a session with one resumable next action rather than a long plan.

Every selected action exposes reason codes and the evidence IDs that justified it.

## Storage boundary

### GBrain

Store only:

- original sources and provenance;
- stable, reviewed concepts;
- durable facts, takes, project direction, and reusable lessons;
- meaningful milestones;
- explicit promotion results.

### Learning ledger

Store:

- attempts and outcomes;
- assistance used;
- questions and misconception history;
- evidence assessments;
- concept-state changes and their evidence IDs;
- review obligations;
- tutor actions and their reasons.

### Study-state plane

Store:

- document identity and change detection;
- reading progress;
- highlights and comments;
- annotation-derived question or misconception candidates;
- resumable conversation state.

### Evidence artifacts

Store the material required to inspect a claim: learner explanations, predictions and observed results, code and tests, execution logs, debugging traces, and reconstruction outputs.

## Promotion boundary

Promotion to GBrain is explicit and reviewable. The CLI may produce a deterministic candidate, but candidate creation does not mean promotion occurred and must not mutate GBrain automatically.

A stable promotion requires source provenance, qualifying independent evidence, no unresolved contradiction that invalidates the claim, and enough boundary testing to state where the concept applies. Delayed evidence should be required when retention is part of the claim.

## Implemented contract versus future model

The repository's schemas, tests, and [architecture document](architecture.md) define what the current version actually implements. Broader learning-model ideas are requirements only after they are represented by a versioned contract and acceptance tests.

In particular, do not infer that an aspirational capability vector, assistance scale, review algorithm, or tutor action exists merely because it is pedagogically desirable. Update this document, the relevant schema, the CLI contract, and acceptance tests together when such behavior becomes executable.
