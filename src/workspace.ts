import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import ledgerSchema from "../schemas/ledger-event.schema.json";
import projectTemplate from "../templates/project.json";
import topicTemplate from "../templates/topic.json";
import { type AnchoredDirectory, openAnchoredDirectory } from "./anchored-fs.ts";

export interface TopicOptions {
  slug: string;
  title: string;
  source: string;
}

export interface CreateTopicHooks {
  afterTopicOpen?: () => void;
}

function assertSlug(slug: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new Error(`invalid topic slug: ${slug}`);
  }
}

function openRegularFile(directory: AnchoredDirectory, name: string): number {
  try {
    const descriptor = openSync(directory.child(name), constants.O_RDONLY | constants.O_NOFOLLOW);
    if (!fstatSync(descriptor).isFile()) {
      closeSync(descriptor);
      throw new Error(`not a regular file: ${name}`);
    }
    return descriptor;
  } catch (error) {
    try {
      if (lstatSync(directory.child(name)).isSymbolicLink()) throw new Error(`path traverses symbolic link: ${name}`);
    } catch (inspectionError) {
      if (inspectionError instanceof Error && inspectionError.message.startsWith("path traverses symbolic link:")) throw inspectionError;
    }
    throw error;
  }
}

function writeAll(descriptor: number, bytes: Uint8Array): void {
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) throw new Error(`short write at offset ${offset}/${bytes.length}`);
    offset += written;
  }
}

function writeNewText(directory: AnchoredDirectory, name: string, content: string): void {
  const descriptor = openSync(
    directory.child(name),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    writeAll(descriptor, Buffer.from(content));
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  directory.fsync();
}

function writeTextIfAbsent(directory: AnchoredDirectory, name: string, content: string): void {
  try {
    writeNewText(directory, name, content);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const descriptor = openRegularFile(directory, name);
    closeSync(descriptor);
  }
}

function copyDescriptor(source: number, destinationDirectory: AnchoredDirectory, destinationName: string): void {
  const destination = openSync(
    destinationDirectory.child(destinationName),
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o644,
  );
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    while (true) {
      const read = readSync(source, buffer, 0, buffer.length, null);
      if (read === 0) break;
      writeAll(destination, buffer.subarray(0, read));
    }
    fsyncSync(destination);
  } finally { closeSync(destination); }
  destinationDirectory.fsync();
}

export function createProject(workspace: string): void {
  const root = openAnchoredDirectory(resolve(workspace), { create: true });
  let schemas: AnchoredDirectory | null = null;
  let topics: AnchoredDirectory | null = null;
  try {
    schemas = root.openDirectory("schemas", { create: true });
    topics = root.openDirectory("topics", { create: true });
    writeTextIfAbsent(root, "gbrain-tutor.json", `${JSON.stringify(projectTemplate, null, 2)}\n`);
    writeTextIfAbsent(schemas, "ledger-event.schema.json", `${JSON.stringify(ledgerSchema, null, 2)}\n`);
    root.fsync();
  } finally {
    topics?.close();
    schemas?.close();
    root.close();
  }
}

export function createTopic(workspace: string, options: TopicOptions, hooks: CreateTopicHooks = {}): string {
  assertSlug(options.slug);
  const sourcePath = resolve(options.source);
  let sourceParent: AnchoredDirectory;
  try { sourceParent = openAnchoredDirectory(dirname(sourcePath)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`source not found: ${options.source}`);
    throw error;
  }
  let sourceDescriptor: number;
  try { sourceDescriptor = openRegularFile(sourceParent, basename(sourcePath)); } catch (error) {
    sourceParent.close();
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`source not found: ${options.source}`);
    throw error;
  }

  const rootPath = resolve(workspace);
  let root: AnchoredDirectory | null = null;
  let topics: AnchoredDirectory | null = null;
  let topic: AnchoredDirectory | null = null;
  try {
    root = openAnchoredDirectory(rootPath);
    const projectConfig = openRegularFile(root, "gbrain-tutor.json");
    closeSync(projectConfig);
    topics = root.openDirectory("topics");
    try {
      topic = topics.openDirectory(options.slug, { create: true, exclusive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`topic already exists: ${options.slug}`);
      throw error;
    }
    hooks.afterTopicOpen?.();

    let ledger: AnchoredDirectory | null = null;
    let sources: AnchoredDirectory | null = null;
    let projections: AnchoredDirectory | null = null;
    let exports: AnchoredDirectory | null = null;
    try {
      ledger = topic.openDirectory("ledger", { create: true });
      sources = topic.openDirectory("sources", { create: true });
      projections = topic.openDirectory("projections", { create: true });
      exports = topic.openDirectory("exports", { create: true });
      const sourceName = basename(sourcePath);
      copyDescriptor(sourceDescriptor, sources, sourceName);
      writeNewText(topic, "topic.json", `${JSON.stringify({
        ...topicTemplate,
        slug: options.slug,
        title: options.title,
        sources: [`sources/${sourceName}`],
      }, null, 2)}\n`);
      writeNewText(ledger, "events.jsonl", "");
      topic.fsync();
      topics.fsync();
    } finally {
      exports?.close();
      projections?.close();
      sources?.close();
      ledger?.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && !root) throw new Error(`not a tutoring workspace: ${rootPath}`);
    throw error;
  } finally {
    topic?.close();
    topics?.close();
    root?.close();
    closeSync(sourceDescriptor);
    sourceParent.close();
  }
  return join(rootPath, "topics", options.slug);
}
