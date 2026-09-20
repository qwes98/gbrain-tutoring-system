import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, createTopic } from "../src/workspace.ts";
import { atomicWriteText } from "../src/atomic-file.ts";
import { appendEvent } from "../src/ledger.ts";

describe("workspace generator", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("creates a repository and topic workspace from a local source", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-workspace-"));
    roots.push(root);
    const source = join(root, "lecture.md");
    writeFileSync(source, "# Lecture\n\nA deterministic system has repeatable outputs.\n");
    const workspace = join(root, "ledger");

    createProject(workspace);
    createTopic(workspace, { slug: "determinism", title: "Determinism", source });

    expect(existsSync(join(workspace, "gbrain-tutor.json"))).toBe(true);
    expect(existsSync(join(workspace, "schemas", "ledger-event.schema.json"))).toBe(true);
    expect(existsSync(join(workspace, "topics", "determinism", "ledger", "events.jsonl"))).toBe(true);
    expect(readFileSync(join(workspace, "topics", "determinism", "sources", "lecture.md"), "utf8"))
      .toContain("repeatable outputs");
  });

  test("refuses to overwrite existing project and topic-owned files", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-workspace-"));
    roots.push(root);
    const source = join(root, "lecture.md");
    writeFileSync(source, "original source\n");
    const workspace = join(root, "ledger");
    createProject(workspace);
    writeFileSync(join(workspace, "gbrain-tutor.json"), '{"operator":"preserved"}\n');

    createProject(workspace);
    expect(readFileSync(join(workspace, "gbrain-tutor.json"), "utf8")).toBe('{"operator":"preserved"}\n');
    createTopic(workspace, { slug: "safe", title: "Safe", source });
    expect(() => createTopic(workspace, { slug: "safe", title: "Replacement", source })).toThrow("topic already exists");
  });

  test("rejects a workspace root that is a symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-workspace-link-"));
    roots.push(root);
    const outside = join(root, "outside");
    const workspace = join(root, "workspace");
    mkdirSync(outside);
    symlinkSync(outside, workspace);

    expect(() => createProject(workspace)).toThrow("symbolic link");
    expect(existsSync(join(outside, "gbrain-tutor.json"))).toBe(false);
  });

  test("rejects an existing workspace-owned file that is a symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-workspace-file-link-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const outside = join(root, "outside.json");
    mkdirSync(workspace);
    writeFileSync(outside, "{}\n");
    symlinkSync(outside, join(workspace, "gbrain-tutor.json"));

    expect(() => createProject(workspace)).toThrow("symbolic link");
  });

  test("rejects topic directory traversal through a symbolic link", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-topic-link-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const outside = join(root, "outside");
    const source = join(root, "lecture.md");
    writeFileSync(source, "source\n");
    createProject(workspace);
    rmSync(join(workspace, "topics"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(workspace, "topics"));

    expect(() => createTopic(workspace, { slug: "escape", title: "Escape", source })).toThrow("symbolic link");
    expect(existsSync(join(outside, "escape"))).toBe(false);
  });

  test("rejects ledger and atomic-write parent symlink escapes", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-storage-link-"));
    roots.push(root);
    const topic = join(root, "topic");
    const outside = join(root, "outside");
    mkdirSync(topic);
    mkdirSync(outside);
    symlinkSync(outside, join(topic, "ledger"));
    symlinkSync(outside, join(topic, "projections"));
    const event = { schema_version: 1 as const, id: "concept", topic: "safe", type: "concept.declared" as const, occurred_at: "2026-01-01T00:00:00.000Z", data: { concept_id: "safe", title: "Safe", source_refs: ["source.md"] } };

    await expect(appendEvent(join(topic, "ledger", "events.jsonl"), event)).rejects.toThrow("symbolic link");
    expect(() => atomicWriteText(join(topic, "projections", "state.json"), "{}\n", { containmentRoot: topic })).toThrow("symbolic link");
    expect(existsSync(join(outside, "events.jsonl"))).toBe(false);
    expect(existsSync(join(outside, "state.json"))).toBe(false);
  });

  test("rejects lexical escape from an explicit atomic-write boundary", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-containment-"));
    roots.push(root);
    const boundary = join(root, "boundary");
    mkdirSync(boundary);

    expect(() => atomicWriteText(join(boundary, "..", "escaped.json"), "{}\n", { containmentRoot: boundary })).toThrow("escapes containment root");
    expect(existsSync(join(root, "escaped.json"))).toBe(false);
  });

  test("rejects symbolic links above a direct storage containment root", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-ancestor-link-"));
    roots.push(root);
    const outside = join(root, "outside");
    const linked = join(root, "linked");
    mkdirSync(join(outside, "nested"), { recursive: true });
    symlinkSync(outside, linked);
    const ledger = join(linked, "nested", "events.jsonl");
    const event = { schema_version: 1 as const, id: "concept", topic: "safe", type: "concept.declared" as const, occurred_at: "2026-01-01T00:00:00.000Z", data: { concept_id: "safe", title: "Safe", source_refs: ["source.md"] } };

    await expect(appendEvent(ledger, event)).rejects.toThrow("symbolic link");
    expect(existsSync(join(outside, "nested", "events.jsonl"))).toBe(false);
  });
});
