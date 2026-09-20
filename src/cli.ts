#!/usr/bin/env bun

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { atomicWriteText } from "./atomic-file.ts";
import { appendEvent, readLedger, transactLedger } from "./ledger.ts";
import { selectTutorAction } from "./policy.ts";
import { projectEvents, writeProjections } from "./projection.ts";
import { validateEvent } from "./schema.ts";
import type { LedgerEvent, LedgerEventType } from "./types.ts";
import { createProject, createTopic } from "./workspace.ts";

const HELP = `gbrain-tutor v0.1

Commands:
  init WORKSPACE
  topic init WORKSPACE SLUG --title TITLE --source FILE
  record concept|question|attempt|evidence|misconception TOPIC_DIR [options]
  resolve-misconception TOPIC_DIR [options]
  correct TOPIC_DIR [options]
  next TOPIC_DIR [--id ID] [--at RFC3339]
  schedule-review TOPIC_DIR --concept ID --due RFC3339 --reason-event ID...
  project TOPIC_DIR [--as-of RFC3339]
  export-gbrain TOPIC_DIR [--as-of RFC3339]
  doctor [--skill SKILL.md]
`;

interface Parsed { positional: string[]; options: Map<string, string[]>; }

function parseArgs(args: string[]): Parsed {
  const positional: string[] = [];
  const options = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (!value.startsWith("--")) { positional.push(value); continue; }
    const name = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`missing value for --${name}`);
    options.set(name, [...options.get(name) ?? [], next]);
    index += 1;
  }
  return { positional, options };
}

function required(parsed: Parsed, name: string): string {
  const value = parsed.options.get(name)?.at(-1);
  if (!value) throw new Error(`missing required option --${name}`);
  return value;
}

function optional(parsed: Parsed, name: string, fallback?: string): string | undefined {
  return parsed.options.get(name)?.at(-1) ?? fallback;
}

function repeated(parsed: Parsed, name: string): string[] {
  return parsed.options.get(name) ?? [];
}

function topicMetadata(topicDir: string): { slug: string } {
  const path = join(topicDir, "topic.json");
  if (!existsSync(path)) throw new Error(`not a topic workspace: ${topicDir}`);
  return JSON.parse(readFileSync(path, "utf8")) as { slug: string };
}

function ledgerPath(topicDir: string): string {
  return join(topicDir, "ledger", "events.jsonl");
}

function eventFrom(topicDir: string, parsed: Parsed, type: LedgerEventType, data: Record<string, unknown>): LedgerEvent {
  return {
    schema_version: 1,
    id: optional(parsed, "id", crypto.randomUUID())!,
    topic: topicMetadata(topicDir).slug,
    type,
    occurred_at: optional(parsed, "at", new Date().toISOString())!,
    data,
  };
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function checkStorageCapabilities(): Promise<boolean> {
  if (process.platform !== "linux" || !existsSync("/proc/self/fd")) return false;
  const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-doctor-"));
  try {
    const atomicPath = join(root, "atomic.json");
    atomicWriteText(atomicPath, "first\n", { containmentRoot: root });
    atomicWriteText(atomicPath, "second\n", { containmentRoot: root });
    if (readFileSync(atomicPath, "utf8") !== "second\n") return false;
    const ledger = join(root, "ledger", "events.jsonl");
    await appendEvent(ledger, {
      schema_version: 1,
      id: "doctor-storage",
      topic: "doctor",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "doctor", title: "Doctor", source_refs: ["doctor"] },
    });
    return readLedger(ledger).events.length === 1;
  } catch {
    return false;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function appendFromRecord(kind: string, topicDir: string, parsed: Parsed): Promise<LedgerEvent> {
  let event: LedgerEvent;
  if (kind === "concept") {
    event = eventFrom(topicDir, parsed, "concept.declared", { concept_id: required(parsed, "concept"), title: required(parsed, "title"), source_refs: repeated(parsed, "source-ref") });
  } else if (kind === "question") {
    event = eventFrom(topicDir, parsed, "question.asked", { question_id: required(parsed, "question"), concept_id: required(parsed, "concept"), prompt: required(parsed, "prompt"), source_refs: repeated(parsed, "source-ref") });
  } else if (kind === "attempt") {
    const correctText = required(parsed, "correct");
    if (correctText !== "true" && correctText !== "false") throw new Error("--correct must be true or false");
    event = eventFrom(topicDir, parsed, "attempt.recorded", { question_id: required(parsed, "question"), concept_id: required(parsed, "concept"), answer: required(parsed, "answer"), correct: correctText === "true", assistance: required(parsed, "assistance") });
  } else if (kind === "evidence") {
    event = eventFrom(topicDir, parsed, "evidence.recorded", { concept_id: required(parsed, "concept"), kind: required(parsed, "kind"), summary: required(parsed, "summary"), ...(optional(parsed, "source-ref") ? { source_ref: optional(parsed, "source-ref") } : {}) });
  } else if (kind === "misconception") {
    event = eventFrom(topicDir, parsed, "misconception.observed", { misconception_id: required(parsed, "misconception"), concept_id: required(parsed, "concept"), description: required(parsed, "description"), evidence_event_ids: repeated(parsed, "evidence-event") });
  } else {
    throw new Error(`unknown record kind: ${kind}`);
  }
  await appendEvent(ledgerPath(topicDir), event);
  return event;
}

async function main(args: string[]): Promise<void> {
  if (args.length === 0 || args.includes("--help") || args[0] === "help") { process.stdout.write(HELP); return; }
  const parsed = parseArgs(args);
  const command = parsed.positional[0];
  if (command === "init") {
    const workspace = resolve(parsed.positional[1] ?? "");
    if (!parsed.positional[1]) throw new Error("usage: gbrain-tutor init WORKSPACE");
    createProject(workspace);
    print({ schema_version: 1, workspace });
  } else if (command === "topic" && parsed.positional[1] === "init") {
    const workspaceArg = parsed.positional[2];
    const slug = parsed.positional[3];
    if (!workspaceArg || !slug) throw new Error("usage: gbrain-tutor topic init WORKSPACE SLUG --title TITLE --source FILE");
    const topic_dir = createTopic(resolve(workspaceArg), { slug, title: required(parsed, "title"), source: resolve(required(parsed, "source")) });
    print({ schema_version: 1, topic_dir, source: basename(required(parsed, "source")) });
  } else if (command === "record") {
    const kind = parsed.positional[1];
    const topicArg = parsed.positional[2];
    if (!kind || !topicArg) throw new Error("usage: gbrain-tutor record KIND TOPIC_DIR [options]");
    const event = await appendFromRecord(kind, resolve(topicArg), parsed);
    print({ schema_version: 1, appended: event });
  } else if (command === "resolve-misconception") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor resolve-misconception TOPIC_DIR [options]");
    const topicDir = resolve(topicArg);
    const event = eventFrom(topicDir, parsed, "misconception.resolved", { misconception_id: required(parsed, "misconception"), evidence_event_ids: repeated(parsed, "evidence-event") });
    await appendEvent(ledgerPath(topicDir), event);
    print({ schema_version: 1, appended: event });
  } else if (command === "correct") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor correct TOPIC_DIR --event ID --replacement-data JSON --reason TEXT");
    const topicDir = resolve(topicArg);
    const replacement = JSON.parse(required(parsed, "replacement-data")) as Record<string, unknown>;
    const event = eventFrom(topicDir, parsed, "event.corrected", { corrects_event_id: required(parsed, "event"), replacement_data: replacement, reason: required(parsed, "reason") });
    await appendEvent(ledgerPath(topicDir), event);
    print({ schema_version: 1, appended: event });
  } else if (command === "next") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor next TOPIC_DIR [--at RFC3339]");
    const topicDir = resolve(topicArg);
    const at = optional(parsed, "at", new Date().toISOString())!;
    const { state, decision, actionEvent, updated } = await transactLedger(ledgerPath(topicDir), (events) => {
      const state = projectEvents([...events], { asOf: at });
      const decision = selectTutorAction(state);
      const actionEvent = eventFrom(topicDir, parsed, "tutor.action", decision as unknown as Record<string, unknown>);
      const updated = projectEvents([...events, actionEvent], { asOf: at });
      return { event: actionEvent, value: { state, decision, actionEvent, updated } };
    });
    writeProjections(topicDir, updated);
    const concept = decision.concept_id ? state.concepts.find((candidate) => candidate.concept_id === decision.concept_id) : undefined;
    const question = decision.question_id ? state.questions.find((candidate) => candidate.question_id === decision.question_id) : undefined;
    const context = {
      concept: concept ? { concept_id: concept.concept_id, title: concept.title, status: concept.status, source_refs: concept.source_refs } : null,
      question: question ? { question_id: question.question_id, prompt: question.prompt, source_refs: question.source_refs } : null,
    };
    print({ schema_version: 1, decision, context, action_event_id: actionEvent.id });
  } else if (command === "schedule-review") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor schedule-review TOPIC_DIR [options]");
    const topicDir = resolve(topicArg);
    const event = eventFrom(topicDir, parsed, "review.scheduled", { concept_id: required(parsed, "concept"), due_at: required(parsed, "due"), reason_event_ids: repeated(parsed, "reason-event") });
    await appendEvent(ledgerPath(topicDir), event);
    print({ schema_version: 1, appended: event });
  } else if (command === "project") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor project TOPIC_DIR [--as-of RFC3339]");
    const topicDir = resolve(topicArg);
    const asOf = optional(parsed, "as-of", new Date().toISOString())!;
    const state = projectEvents(readLedger(ledgerPath(topicDir)).events, { asOf });
    writeProjections(topicDir, state);
    print({ schema_version: 1, topic: state.topic, event_count: readLedger(ledgerPath(topicDir)).events.length, concept_count: state.concepts.length });
  } else if (command === "export-gbrain") {
    const topicArg = parsed.positional[1];
    if (!topicArg) throw new Error("usage: gbrain-tutor export-gbrain TOPIC_DIR [--as-of RFC3339]");
    const topicDir = resolve(topicArg);
    const asOf = optional(parsed, "as-of", new Date().toISOString())!;
    const state = projectEvents(readLedger(ledgerPath(topicDir)).events, { asOf });
    const output = { schema_version: 1, boundary: "gbrain-promotion-candidate", generated_at: asOf, source_topic: state.topic, mutates_gbrain: false, candidates: state.promotion_candidates };
    atomicWriteText(join(topicDir, "exports", "gbrain-promotion-candidates.json"), `${JSON.stringify(output, null, 2)}\n`);
    print({ schema_version: 1, output: join(topicDir, "exports", "gbrain-promotion-candidates.json"), candidate_count: state.promotion_candidates.length, mutates_gbrain: false });
  } else if (command === "doctor") {
    const skill = resolve(optional(parsed, "skill", join(import.meta.dir, "..", "skills", "gbrain-tutor", "SKILL.md"))!);
    const sample = validateEvent({ schema_version: 1, id: "doctor", topic: "doctor", type: "evidence.recorded", occurred_at: "2026-01-01T00:00:00.000Z", data: { concept_id: "doctor", kind: "observation", summary: "schema probe" } });
    const checks = {
      bun: typeof Bun.version === "string",
      storage: await checkStorageCapabilities(),
      schema: sample.valid,
      skill: existsSync(skill) && readFileSync(skill, "utf8").startsWith("---\n"),
    };
    print({ schema_version: 1, ok: Object.values(checks).every(Boolean), checks, skill });
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
  } else {
    throw new Error(`unknown command: ${command ?? ""}\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
