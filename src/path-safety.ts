import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

function isContained(root: string, candidate: string): boolean {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export function assertLexicallyContainedPath(containmentRoot: string, target: string): void {
  const root = resolve(containmentRoot);
  const candidate = resolve(target);
  if (!isContained(root, candidate)) {
    throw new Error(`path escapes containment root: ${candidate}`);
  }
}

function prospectiveCanonical(path: string): string {
  const missing: string[] = [];
  let cursor = resolve(path);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) break;
    missing.unshift(cursor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    cursor = parent;
  }
  const base = existsSync(cursor) ? realpathSync(cursor) : cursor;
  return missing.reduce((current, segment) => join(current, segment), base);
}

function assertNoSymlinkChain(root: string, target: string): void {
  const relation = relative(root, target);
  const segments = relation === "" ? [] : relation.split(sep);
  let cursor = root;
  for (const segment of ["", ...segments]) {
    if (segment) cursor = join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`path traverses symbolic link: ${cursor}`);
    }
  }
}

function assertNoSymlinkAncestors(target: string): void {
  const absolute = resolve(target);
  const filesystemRoot = parse(absolute).root;
  const segments = relative(filesystemRoot, absolute).split(sep).filter(Boolean);
  let cursor = filesystemRoot;
  for (const segment of segments) {
    cursor = join(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`path traverses symbolic link: ${cursor}`);
    }
  }
}

export function assertContainedPath(containmentRoot: string, target: string): void {
  const root = resolve(containmentRoot);
  const candidate = resolve(target);
  assertLexicallyContainedPath(root, candidate);
  assertNoSymlinkAncestors(root);
  assertNoSymlinkChain(root, candidate);
  const canonicalRoot = prospectiveCanonical(root);
  const canonicalCandidate = prospectiveCanonical(candidate);
  if (!isContained(canonicalRoot, canonicalCandidate)) {
    throw new Error(`path escapes canonical containment root: ${candidate}`);
  }
}
