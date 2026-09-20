import { closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { dlopen } from "bun:ffi";
import { openAnchoredDirectory } from "./anchored-fs.ts";
import { assertLexicallyContainedPath } from "./path-safety.ts";

export interface AtomicWriteOptions {
  containmentRoot?: string;
  afterParentOpen?: () => void;
  afterTempFsync?: (temporaryPath: string) => void;
  afterTargetProbe?: (targetPath: string) => void;
  afterExchange?: (targetPath: string) => void;
}

const openLibc = () => dlopen("libc.so.6", {
  linkat: { args: ["i32", "cstring", "i32", "cstring", "i32"], returns: "i32" } as const,
  renameat2: { args: ["i32", "cstring", "i32", "cstring", "u32"], returns: "i32" } as const,
});
let libc: ReturnType<typeof openLibc> | null = null;
function nativeStorage(): ReturnType<typeof openLibc> {
  if (process.platform !== "linux") throw new Error("descriptor-anchored storage requires Linux procfs");
  return libc ??= openLibc();
}
const AT_EMPTY_PATH = 0x1000;
const RENAME_EXCHANGE = 2;
const PUBLICATION_ATTEMPTS = 8;

function pathMatchesDescriptor(parent: ReturnType<typeof openAnchoredDirectory>, name: string, descriptor: number): boolean {
  let candidate: number;
  try { candidate = openSync(parent.child(name), constants.O_RDONLY | constants.O_NOFOLLOW); } catch { return false; }
  try {
    const expected = fstatSync(descriptor, { bigint: true });
    const actual = fstatSync(candidate, { bigint: true });
    return expected.dev === actual.dev && expected.ino === actual.ino;
  } finally { closeSync(candidate); }
}

function restoreMovedReplacement(parent: ReturnType<typeof openAnchoredDirectory>, originalName: string, claimName: string): void {
  try {
    linkSync(parent.child(claimName), parent.child(originalName));
    unlinkSync(parent.child(claimName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function removeNameIfOwned(parent: ReturnType<typeof openAnchoredDirectory>, name: string, descriptor: number): void {
  const claimName = `.cleanup-${crypto.randomUUID()}`;
  try { renameSync(parent.child(name), parent.child(claimName)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (pathMatchesDescriptor(parent, claimName, descriptor)) unlinkSync(parent.child(claimName));
  else restoreMovedReplacement(parent, name, claimName);
}

function unlinkPrivateName(parent: ReturnType<typeof openAnchoredDirectory>, name: string): void {
  try { unlinkSync(parent.child(name)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function fsyncDirectory(path: string): void {
  let directory;
  try {
    directory = openAnchoredDirectory(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" || code === "EINVAL" || code === "ENOTSUP") return;
    throw error;
  }
  try { directory.fsync(); } finally { directory.close(); }
}

export function atomicWriteText(path: string, content: string, options: AtomicWriteOptions = {}): void {
  const absolute = resolve(path);
  const containmentRoot = options.containmentRoot ?? dirname(absolute);
  assertLexicallyContainedPath(containmentRoot, absolute);
  const parent = openAnchoredDirectory(dirname(absolute), { create: true });
  const name = basename(absolute);
  const temporaryName = `${name}.tmp.${process.pid}.${crypto.randomUUID()}`;
  let descriptor: number | null = null;
  let previousTarget: number | null = null;
  let publicationName: string | null = null;
  try {
    options.afterParentOpen?.();
    try {
      if (lstatSync(parent.child(name)).isSymbolicLink()) throw new Error(`path traverses symbolic link: ${absolute}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    descriptor = openSync(parent.child(temporaryName), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
    const bytes = Buffer.from(content);
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
      if (written <= 0) throw new Error(`short write at offset ${offset}/${bytes.length}`);
      offset += written;
    }
    fsyncSync(descriptor);
    options.afterTempFsync?.(parent.child(temporaryName));
    if (!pathMatchesDescriptor(parent, temporaryName, descriptor)) throw new Error(`atomic temporary file was replaced: ${absolute}`);

    for (let attempt = 0; ; attempt += 1) {
      const retryable = attempt < PUBLICATION_ATTEMPTS;
      try { previousTarget = openSync(parent.child(name), constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        previousTarget = null;
      }
      if (previousTarget !== null && !fstatSync(previousTarget).isFile()) {
        throw new Error(`atomic target is not a regular file: ${absolute}`);
      }
      options.afterTargetProbe?.(parent.child(name));
      if (previousTarget === null) {
        if (nativeStorage().symbols.linkat(descriptor, "", parent.descriptor, name, AT_EMPTY_PATH) === 0) break;
        if (!retryable) throw new Error(`atomic target changed during publication: ${absolute}`);
        continue;
      }
      publicationName = `.publish-${crypto.randomUUID()}`;
      if (nativeStorage().symbols.linkat(descriptor, "", parent.descriptor, publicationName, AT_EMPTY_PATH) !== 0) {
        throw new Error(`failed to stage atomic publication: ${absolute}`);
      }
      if (nativeStorage().symbols.renameat2(parent.descriptor, publicationName, parent.descriptor, name, RENAME_EXCHANGE) !== 0) {
        unlinkPrivateName(parent, publicationName);
        publicationName = null;
        closeSync(previousTarget);
        previousTarget = null;
        if (!retryable) throw new Error(`atomic target changed during publication: ${absolute}`);
        continue;
      }
      options.afterExchange?.(parent.child(name));
      if (!pathMatchesDescriptor(parent, name, descriptor)) {
        if (pathMatchesDescriptor(parent, publicationName, previousTarget)) {
          nativeStorage().symbols.renameat2(parent.descriptor, publicationName, parent.descriptor, name, RENAME_EXCHANGE);
        }
        unlinkPrivateName(parent, publicationName);
        publicationName = null;
        closeSync(previousTarget);
        previousTarget = null;
        if (!retryable) throw new Error(`atomic publication was replaced: ${absolute}`);
        continue;
      }
      removeNameIfOwned(parent, publicationName, previousTarget);
      unlinkPrivateName(parent, publicationName);
      publicationName = null;
      break;
    }
    removeNameIfOwned(parent, temporaryName, descriptor);
    parent.fsync();
  } catch (error) {
    try { if (descriptor !== null) removeNameIfOwned(parent, temporaryName, descriptor); } catch { /* best-effort cleanup */ }
    try { if (publicationName !== null && descriptor !== null) removeNameIfOwned(parent, publicationName, descriptor); } catch { /* best-effort cleanup */ }
    throw error;
  } finally {
    if (previousTarget !== null) closeSync(previousTarget);
    if (descriptor !== null) closeSync(descriptor);
    parent.close();
  }
}
