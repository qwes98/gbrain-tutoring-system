import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

  test("fails closed without changing a partial topic when topic metadata is missing", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-partial-topic-"));
    roots.push(root);
    const source = join(root, "lecture.md");
    const workspace = join(root, "workspace");
    writeFileSync(source, "replacement source\n");
    createProject(workspace);
    const topicDir = join(workspace, "topics", "partial");
    mkdirSync(join(topicDir, "sources"), { recursive: true });
    mkdirSync(join(topicDir, "ledger"), { recursive: true });
    const ownedSource = join(topicDir, "sources", "lecture.md");
    const ownedLedger = join(topicDir, "ledger", "events.jsonl");
    writeFileSync(ownedSource, "preserved source bytes\n");
    writeFileSync(ownedLedger, "preserved ledger bytes\n");

    expect(() => createTopic(workspace, { slug: "partial", title: "Replacement", source })).toThrow("topic already exists");

    expect(readFileSync(ownedSource, "utf8")).toBe("preserved source bytes\n");
    expect(readFileSync(ownedLedger, "utf8")).toBe("preserved ledger bytes\n");
    expect(existsSync(join(topicDir, "topic.json"))).toBe(false);
    expect(existsSync(join(topicDir, "projections"))).toBe(false);
    expect(existsSync(join(topicDir, "exports"))).toBe(false);
  });

  test("closes every descriptor when partial topic directory setup fails", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-topic-fd-cleanup-"));
    roots.push(root);
    const source = join(root, "lecture.md");
    const workspace = join(root, "workspace");
    writeFileSync(source, "source\n");
    createProject(workspace);
    const before = readdirSync("/proc/self/fd").length;

    for (let index = 0; index < 20; index += 1) {
      const slug = `partial-${index}`;
      expect(() => createTopic(workspace, { slug, title: "Partial", source }, {
        afterTopicOpen: () => writeFileSync(join(workspace, "topics", slug, "sources"), "not a directory\n"),
      })).toThrow();
    }

    expect(readdirSync("/proc/self/fd").length).toBeLessThanOrEqual(before + 2);
  });

  test("keeps topic source copy and owned files anchored during an ancestor swap", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-topic-swap-"));
    roots.push(root);
    const source = join(root, "lecture.md");
    const workspace = join(root, "workspace");
    const moved = join(root, "workspace-moved");
    const outside = join(root, "outside");
    writeFileSync(source, "anchored source bytes\n");
    createProject(workspace);
    mkdirSync(join(outside, "topics", "swap", "sources"), { recursive: true });
    const outsideSource = join(outside, "topics", "swap", "sources", "lecture.md");
    writeFileSync(outsideSource, "outside sentinel\n");
    let swapped = false;

    createTopic(workspace, { slug: "swap", title: "Swap", source }, {
      afterTopicOpen: () => {
        renameSync(workspace, moved);
        symlinkSync(outside, workspace);
        swapped = true;
      },
    });

    expect(swapped).toBe(true);
    expect(readFileSync(outsideSource, "utf8")).toBe("outside sentinel\n");
    expect(readFileSync(join(moved, "topics", "swap", "sources", "lecture.md"), "utf8")).toBe("anchored source bytes\n");
    expect(JSON.parse(readFileSync(join(moved, "topics", "swap", "topic.json"), "utf8")).slug).toBe("swap");
    expect(readFileSync(join(moved, "topics", "swap", "ledger", "events.jsonl"), "utf8")).toBe("");
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

  test("keeps an atomic write anchored when an ancestor is replaced by a symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-atomic-swap-"));
    roots.push(root);
    const topic = join(root, "topic");
    const moved = join(root, "topic-moved");
    const outside = join(root, "outside");
    mkdirSync(join(topic, "projections"), { recursive: true });
    mkdirSync(join(outside, "projections"), { recursive: true });
    const outsideTarget = join(outside, "projections", "state.json");
    writeFileSync(outsideTarget, "outside sentinel\n");
    let swapped = false;

    atomicWriteText(join(topic, "projections", "state.json"), "anchored bytes\n", {
      containmentRoot: topic,
      afterParentOpen: () => {
        renameSync(topic, moved);
        symlinkSync(outside, topic);
        swapped = true;
      },
    });

    expect(swapped).toBe(true);
    expect(readFileSync(outsideTarget, "utf8")).toBe("outside sentinel\n");
    expect(readFileSync(join(moved, "projections", "state.json"), "utf8")).toBe("anchored bytes\n");
  });

  test("fails closed when the atomic temporary name is replaced before publication", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-atomic-temp-swap-"));
    roots.push(root);
    const directory = join(root, "projections");
    const target = join(directory, "state.json");
    const outside = join(root, "outside.json");
    mkdirSync(directory);
    writeFileSync(target, "original bytes\n");
    writeFileSync(outside, "outside bytes\n");

    expect(() => atomicWriteText(target, "intended bytes\n", {
      containmentRoot: directory,
      afterTempFsync: (temporaryPath) => {
        unlinkSync(temporaryPath);
        symlinkSync(outside, temporaryPath);
      },
    })).toThrow("temporary file was replaced");

    expect(readFileSync(target, "utf8")).toBe("original bytes\n");
    expect(readFileSync(outside, "utf8")).toBe("outside bytes\n");
  });

  test("refuses to exchange an atomic file with an existing directory", () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-atomic-directory-target-"));
    roots.push(root);
    const projections = join(root, "projections");
    const target = join(projections, "state.json");
    const sentinel = join(target, "sentinel.txt");
    mkdirSync(target, { recursive: true });
    writeFileSync(sentinel, "preserved directory bytes\n");
    const before = readdirSync(projections).sort();

    expect(() => atomicWriteText(target, "replacement file\n", { containmentRoot: projections }))
      .toThrow("not a regular file");

    expect(readFileSync(sentinel, "utf8")).toBe("preserved directory bytes\n");
    expect(readdirSync(projections).sort()).toEqual(before);
  });

  test("keeps a ledger transaction anchored when an ancestor is replaced by a symlink", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-tutor-ledger-swap-"));
    roots.push(root);
    const topic = join(root, "topic");
    const moved = join(root, "topic-moved");
    const outside = join(root, "outside");
    mkdirSync(join(topic, "ledger"), { recursive: true });
    mkdirSync(join(outside, "ledger"), { recursive: true });
    const outsideLedger = join(outside, "ledger", "events.jsonl");
    writeFileSync(outsideLedger, "outside sentinel\n");
    const event = { schema_version: 1 as const, id: "concept", topic: "safe", type: "concept.declared" as const, occurred_at: "2026-01-01T00:00:00Z", data: { concept_id: "safe", title: "Safe", source_refs: ["source.md"] } };
    let swapped = false;

    await appendEvent(join(topic, "ledger", "events.jsonl"), event, {
      afterLedgerParentOpen: () => {
        renameSync(topic, moved);
        symlinkSync(outside, topic);
        swapped = true;
      },
    });

    expect(swapped).toBe(true);
    expect(readFileSync(outsideLedger, "utf8")).toBe("outside sentinel\n");
    expect(JSON.parse(readFileSync(join(moved, "ledger", "events.jsonl"), "utf8").trim()).id).toBe("concept");
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
