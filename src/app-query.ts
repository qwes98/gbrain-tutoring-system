import { closeSync, constants, fstatSync, openSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { openAnchoredDirectory, type AnchoredDirectory } from "./anchored-fs.ts";
import type { ProjectionSnapshot, TopicList, TopicSnapshot, TopicSummary, WorkspaceList } from "./contracts.ts";
import { readLedger } from "./ledger.ts";
import { projectEvents } from "./projection.ts";
import { inspectActiveDocument, readStudyState } from "./study-state.ts";

interface TopicMetadata {
  schema_version: 1;
  slug: string;
  title: string;
  sources: string[];
}

function readJsonFile<T>(directory: AnchoredDirectory, name: string): T {
  const descriptor = openSync(directory.child(name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error(`not a regular file: ${name}`);
    return JSON.parse(readFileSync(descriptor, "utf8")) as T;
  } finally { closeSync(descriptor); }
}

function topicSummary(topicPath: string): TopicSummary {
  const path = resolve(topicPath);
  const topic = openAnchoredDirectory(path);
  try {
    const metadata = readJsonFile<TopicMetadata>(topic, "topic.json");
    return { path, slug: metadata.slug, title: metadata.title, sources: [...metadata.sources].sort() };
  } finally { topic.close(); }
}

export function listWorkspaces(paths: string[]): WorkspaceList {
  const workspaces = paths.map((candidate) => {
    const path = resolve(candidate);
    const root = openAnchoredDirectory(path);
    let topics: AnchoredDirectory | null = null;
    try {
      readJsonFile(root, "gbrain-tutor.json");
      topics = root.openDirectory("topics");
      const topic_count = readdirSync(topics.path(), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
      return { path, name: basename(path), topic_count };
    } finally {
      topics?.close();
      root.close();
    }
  }).sort((left, right) => left.path.localeCompare(right.path));
  return { schema_version: 1, workspaces };
}

export function listTopics(workspace: string): TopicList {
  const rootPath = resolve(workspace);
  const root = openAnchoredDirectory(rootPath);
  let topicsDirectory: AnchoredDirectory | null = null;
  try {
    readJsonFile(root, "gbrain-tutor.json");
    topicsDirectory = root.openDirectory("topics");
    const topics = readdirSync(topicsDirectory.path(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => topicSummary(join(rootPath, "topics", entry.name)))
      .sort((left, right) => left.slug.localeCompare(right.slug));
    return { schema_version: 1, workspace: rootPath, topics };
  } finally {
    topicsDirectory?.close();
    root.close();
  }
}

export function openTopic(topicDir: string): TopicSnapshot {
  const state = readStudyState(topicDir);
  return {
    schema_version: 1,
    topic: topicSummary(topicDir),
    active_document: inspectActiveDocument(topicDir, state.active_document),
    resume: state.resume,
    study: {
      progress_count: state.progress.length,
      highlight_count: state.highlights.length,
      comment_count: state.comments.length,
      candidate_count: state.candidates.length,
      progress: state.progress,
      highlights: state.highlights,
      comments: state.comments,
      candidates: state.candidates,
      conversation: state.conversation,
    },
  };
}

export function resumeTopic(topicDir: string): TopicSnapshot {
  return openTopic(topicDir);
}

export function readProjectionSnapshot(topicDir: string, asOf: string): ProjectionSnapshot {
  const path = resolve(topicDir);
  const projection = projectEvents(readLedger(join(path, "ledger", "events.jsonl")).events, { asOf });
  return { schema_version: 1, topic: projection.topic, as_of: asOf, projection };
}
