import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { assertContainedPath } from "./path-safety.ts";

export interface AtomicWriteOptions { containmentRoot?: string; }

export function fsyncDirectory(path: string): void {
  let directory: number;
  try {
    directory = openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (process.platform === "win32" || code === "EINVAL" || code === "ENOTSUP") return;
    throw error;
  }
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

export function atomicWriteText(path: string, content: string, options: AtomicWriteOptions = {}): void {
  const containmentRoot = options.containmentRoot ?? dirname(path);
  assertContainedPath(containmentRoot, path);
  mkdirSync(dirname(path), { recursive: true });
  assertContainedPath(containmentRoot, path);
  const temporary = `${path}.tmp.${process.pid}.${crypto.randomUUID()}`;
  assertContainedPath(containmentRoot, temporary);
  try {
    const descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
    try {
      const bytes = Buffer.from(content);
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error(`short write at offset ${offset}/${bytes.length}`);
        offset += written;
      }
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* best-effort cleanup */ }
    throw error;
  }
}
