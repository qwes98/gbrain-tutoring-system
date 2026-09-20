import { copyFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import ledgerSchema from "../schemas/ledger-event.schema.json";
import projectTemplate from "../templates/project.json";
import topicTemplate from "../templates/topic.json";
import { atomicWriteText } from "./atomic-file.ts";
import { assertContainedPath } from "./path-safety.ts";

export interface TopicOptions {
  slug: string;
  title: string;
  source: string;
}

function assertSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`invalid topic slug: ${slug}`);
  }
}

export function createProject(workspace: string): void {
  const root = resolve(workspace);
  assertContainedPath(root, root);
  mkdirSync(join(root, "schemas"), { recursive: true });
  mkdirSync(join(root, "topics"), { recursive: true });
  assertContainedPath(root, join(root, "schemas"));
  assertContainedPath(root, join(root, "topics"));
  const configPath = join(root, "gbrain-tutor.json");
  const schemaPath = join(root, "schemas", "ledger-event.schema.json");
  assertContainedPath(root, configPath);
  assertContainedPath(root, schemaPath);
  if (!existsSync(configPath)) atomicWriteText(configPath, `${JSON.stringify(projectTemplate, null, 2)}\n`, { containmentRoot: root });
  if (!existsSync(schemaPath)) atomicWriteText(schemaPath, `${JSON.stringify(ledgerSchema, null, 2)}\n`, { containmentRoot: root });
}

export function createTopic(workspace: string, options: TopicOptions): string {
  assertSlug(options.slug);
  if (!existsSync(options.source)) throw new Error(`source not found: ${options.source}`);
  const root = resolve(workspace);
  assertContainedPath(root, root);
  const projectConfig = join(root, "gbrain-tutor.json");
  assertContainedPath(root, projectConfig);
  if (!existsSync(projectConfig)) throw new Error(`not a tutoring workspace: ${root}`);
  const topicDir = join(root, "topics", options.slug);
  assertContainedPath(root, topicDir);
  if (existsSync(join(topicDir, "topic.json"))) throw new Error(`topic already exists: ${options.slug}`);
  for (const path of ["ledger", "sources", "projections", "exports"]) {
    mkdirSync(join(topicDir, path), { recursive: true });
    assertContainedPath(root, join(topicDir, path));
  }
  const sourceName = basename(options.source);
  const copiedSource = join(topicDir, "sources", sourceName);
  assertContainedPath(root, copiedSource);
  copyFileSync(options.source, copiedSource);
  atomicWriteText(join(topicDir, "topic.json"), `${JSON.stringify({
    ...topicTemplate,
    slug: options.slug,
    title: options.title,
    sources: [`sources/${sourceName}`],
  }, null, 2)}\n`, { containmentRoot: root });
  const ledger = join(topicDir, "ledger", "events.jsonl");
  atomicWriteText(ledger, "", { containmentRoot: root });
  return topicDir;
}
