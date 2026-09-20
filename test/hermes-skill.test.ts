import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Hermes tutoring skill", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("is a portable personal skill that delegates all state changes to the CLI", () => {
    const path = join(import.meta.dir, "..", "skills", "gbrain-tutor", "SKILL.md");
    const content = readFileSync(path, "utf8");

    expect(content.startsWith("---\nname: gbrain-tutor\n")).toBe(true);
    expect(content).toContain("description: Select and record one evidence-based tutoring action.");
    expect(content).toContain("gbrain-tutor next");
    expect(content).toContain("JSON `context`");
    expect(content).toContain("gbrain-tutor export-gbrain");
    expect(content).toContain("Never write to GBrain directly");
    expect(content).toContain("## Verification");
  });

  test("an installed skill loads through Hermes and schedules a historical decision at the turn time", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-hermes-installed-"));
    roots.push(root);
    const hermesHome = join(root, "hermes-home");
    const installedSkill = join(hermesHome, "skills", "gbrain-tutor");
    mkdirSync(join(hermesHome, "skills"), { recursive: true });
    cpSync(join(import.meta.dir, "..", "skills", "gbrain-tutor"), installedSkill, { recursive: true });

    const loader = Bun.spawn([
      "python3",
      "-c",
      [
        "import json",
        "from agent.skill_commands import build_preloaded_skills_prompt",
        "prompt, loaded, missing = build_preloaded_skills_prompt(['gbrain-tutor'])",
        "print(json.dumps({'prompt': prompt, 'loaded': loaded, 'missing': missing}))",
      ].join("; "),
    ], {
      env: {
        ...process.env,
        HERMES_HOME: hermesHome,
        PYTHONPATH: "/opt/hermes-agent",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [loaderStdout, loaderStderr, loaderExit] = await Promise.all([
      new Response(loader.stdout).text(),
      new Response(loader.stderr).text(),
      loader.exited,
    ]);
    expect(loaderExit, loaderStderr).toBe(0);
    const loaded = JSON.parse(loaderStdout) as { prompt: string; loaded: string[]; missing: string[] };
    expect(loaded.loaded).toEqual(["gbrain-tutor"]);
    expect(loaded.missing).toEqual([]);

    const workspace = join(root, "workspace");
    const source = join(import.meta.dir, "fixtures", "concurrency-lecture.md");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    const bin = join(root, "bin");
    const installedCli = join(bin, "gbrain-tutor");
    mkdirSync(bin);
    symlinkSync(cli, installedCli);
    const run = async (...args: string[]) => {
      const child = Bun.spawn([installedCli, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      if (exit !== 0) throw new Error(`command failed (${args.join(" ")}): ${stderr}`);
      return JSON.parse(stdout) as Record<string, unknown>;
    };

    await run("init", workspace);
    await run("topic", "init", workspace, "historical", "--title", "Historical turn", "--source", source);
    const topic = join(workspace, "topics", "historical");
    await run("record", "concept", topic, "--id", "concept-event", "--concept", "append", "--title", "Append-only logs", "--source-ref", "sources/concurrency-lecture.md", "--at", "2020-01-01T00:00:00.000Z");
    await run("record", "question", topic, "--id", "q1-event", "--question", "q1", "--concept", "append", "--prompt", "How are corrections stored?", "--source-ref", "sources/concurrency-lecture.md", "--at", "2020-01-01T00:01:00.000Z");
    await run("record", "attempt", topic, "--id", "a1", "--question", "q1", "--concept", "append", "--answer", "As a new event", "--correct", "true", "--assistance", "none", "--at", "2020-01-01T00:02:00.000Z");
    await run("record", "question", topic, "--id", "q2-event", "--question", "q2", "--concept", "append", "--prompt", "What terminates a JSONL record?", "--source-ref", "sources/concurrency-lecture.md", "--at", "2020-01-01T00:03:00.000Z");
    await run("record", "attempt", topic, "--id", "a2", "--question", "q2", "--concept", "append", "--answer", "A newline", "--correct", "true", "--assistance", "none", "--at", "2020-01-01T00:04:00.000Z");

    const turnTime = "2020-01-01T00:05:00.000Z";
    const next = await run("next", topic, "--id", "action-event", "--at", turnTime);
    const decision = next.decision as { action: string; concept_id: string; due_at: string; evidence_event_ids: string[] };
    expect(decision.action).toBe("schedule_review");
    const manifest = JSON.parse(readFileSync(join(topic, "projections", "current.json"), "utf8")) as {
      generation_id: string;
      files: string[];
    };
    expect(manifest.files).toContain("topic-state.json");
    const projectedState = JSON.parse(readFileSync(
      join(topic, "projections", "generations", manifest.generation_id, "topic-state.json"),
      "utf8",
    )) as { tutor_actions: Array<{ id: string }> };
    expect(projectedState.tutor_actions.some((event) => event.id === "action-event")).toBe(true);
    await run(
      "schedule-review", topic,
      "--id", "review-event",
      "--concept", decision.concept_id,
      "--due", decision.due_at,
      ...decision.evidence_event_ids.flatMap((id) => ["--reason-event", id]),
      "--at", turnTime,
    );

    const records = readFileSync(join(topic, "ledger", "events.jsonl"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; occurred_at: string; data: Record<string, unknown> });
    const review = records.find((event) => event.id === "review-event");
    expect(review?.occurred_at).toBe(turnTime);
    expect(review?.data.due_at).toBe(decision.due_at);
    expect(loaded.prompt).toContain('--due \\"$DECISION_DUE_AT\\"');
    expect(loaded.prompt).toContain('--at \\"$TURN_TIME\\"');
    expect(loaded.prompt).toContain("projections/current.json");
    expect(loaded.prompt).toContain("projections/generations/<generation_id>/topic-state.json");
    expect(loaded.prompt).not.toContain("projections/topic-state.json");
  }, 30_000);
});
