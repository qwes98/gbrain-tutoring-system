import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendEvent } from "../src/ledger.ts";
import {
  listTopics,
  listWorkspaces,
  openTopic,
  readProjectionSnapshot,
  resumeTopic,
} from "../src/app-query.ts";
import { validateAppContract } from "../src/contracts.ts";
import { createProject, createTopic } from "../src/workspace.ts";

describe("v0.2 public app contract", () => {
  const roots: string[] = [];
  afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));

  test("publishes typed schema-backed workspace, topic, and projection queries", async () => {
    const root = mkdtempSync(join(tmpdir(), "gbrain-app-contract-"));
    roots.push(root);
    const workspace = join(root, "workspace");
    const source = join(root, "source.pdf");
    writeFileSync(source, "%PDF-1.4\nfixture\n");
    createProject(workspace);
    const zeta = createTopic(workspace, { slug: "zeta", title: "Zeta", source });
    createTopic(workspace, { slug: "alpha", title: "Alpha", source });

    await appendEvent(join(zeta, "ledger", "events.jsonl"), {
      schema_version: 1,
      id: "concept",
      topic: "zeta",
      type: "concept.declared",
      occurred_at: "2026-01-01T00:00:00Z",
      data: { concept_id: "pdf", title: "PDF identity", source_refs: ["sources/source.pdf"] },
    });

    const workspaces = listWorkspaces([workspace]);
    const topics = listTopics(workspace);
    const topic = openTopic(zeta);
    const resumed = resumeTopic(zeta);
    const projection = readProjectionSnapshot(zeta, "2026-01-02T00:00:00Z");

    expect(validateAppContract("workspace_list", workspaces)).toEqual({ valid: true, errors: [] });
    expect(validateAppContract("topic_list", topics)).toEqual({ valid: true, errors: [] });
    expect(validateAppContract("topic_snapshot", topic)).toEqual({ valid: true, errors: [] });
    expect(validateAppContract("projection_snapshot", projection)).toEqual({ valid: true, errors: [] });
    expect(workspaces.workspaces.map((item) => item.path)).toEqual([workspace]);
    expect(topics.topics.map((item) => item.slug)).toEqual(["alpha", "zeta"]);
    expect(topic).toMatchObject({
      schema_version: 1,
      topic: { slug: "zeta", title: "Zeta" },
      active_document: null,
      resume: null,
      study: { progress_count: 0, highlight_count: 0, comment_count: 0, candidate_count: 0 },
    });
    expect(resumed).toEqual(topic);
    expect(projection.projection.concepts[0]?.concept_id).toBe("pdf");
    expect(existsSync(join(workspace, "schemas", "app-contract.v1.schema.json"))).toBe(true);
  });
});
