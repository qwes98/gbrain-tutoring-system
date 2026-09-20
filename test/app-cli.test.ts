import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("v0.2 headless app CLI", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("lists, opens, resumes, mutates, and reads receipts without projection-file parsing", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-app-cli-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "book.pdf");
    const cli = join(import.meta.dir, "..", "src", "cli.ts");
    writeFileSync(source, "%PDF-1.4\nheadless fixture\n");
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      if (exit !== 0) throw new Error(`command failed (${args.join(" ")}): ${stderr}`);
      return JSON.parse(stdout) as Record<string, any>;
    };

    await run("init", workspace);
    await run("topic", "init", workspace, "book", "--title", "Book", "--source", source);
    const topic = join(workspace, "topics", "book");
    expect((await run("workspace", "list", workspace)).workspaces).toHaveLength(1);
    expect((await run("topic", "list", workspace)).topics[0].slug).toBe("book");
    expect((await run("topic", "open", topic)).active_document).toBeNull();
    expect((await run("projection", "get", topic, "--as-of", "2026-01-01T00:00:00Z")).projection.topic).toBe("unknown");

    const registration = await run(
      "pdf", "register", topic,
      "--request-id", "pdf-1",
      "--document", "book-v1",
      "--relative-path", "sources/book.pdf",
      "--pages", "4",
      "--at", "2026-01-01T00:00:00Z",
    );
    await run(
      "study", "progress", "set", topic,
      "--request-id", "progress-1",
      "--chapter", "chapter-1",
      "--page", "2",
      "--position", "0.5",
      "--completed", "false",
      "--at", "2026-01-01T00:01:00Z",
    );

    expect(await run("receipt", "get", topic, "--request-id", "pdf-1")).toEqual(registration);
    expect(await run("topic", "resume", topic)).toMatchObject({
      active_document: { document_id: "book-v1", status: "exact" },
      resume: { chapter_id: "chapter-1", physical_page: 2, position: 0.5 },
    });
  });
});
