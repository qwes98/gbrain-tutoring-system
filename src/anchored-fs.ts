import { closeSync, constants, existsSync, fsyncSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { isAbsolute, parse, relative, resolve, sep } from "node:path";

export interface OpenAnchoredDirectoryOptions {
  create?: boolean;
  exclusive?: boolean;
  mode?: number;
}

function childPath(descriptor: number, name: string): string {
  if (name.length === 0 || name === "." || name === ".." || name.includes("/") || name.includes("\0")) {
    throw new Error(`invalid anchored path component: ${JSON.stringify(name)}`);
  }
  return `/proc/self/fd/${descriptor}/${name}`;
}

function openDirectoryAt(parent: number, name: string): number {
  const path = childPath(parent, name);
  try {
    return openSync(path, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | constants.O_NOFOLLOW);
  } catch (error) {
    try {
      if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`path traverses symbolic link: ${path}`);
    } catch (inspectionError) {
      if (inspectionError instanceof Error && inspectionError.message.startsWith("path traverses symbolic link:")) throw inspectionError;
    }
    throw error;
  }
}

export class AnchoredDirectory {
  readonly descriptor: number;
  #closed = false;

  constructor(descriptor: number) {
    this.descriptor = descriptor;
  }

  child(name: string): string {
    if (this.#closed) throw new Error("anchored directory is closed");
    return childPath(this.descriptor, name);
  }

  path(): string {
    if (this.#closed) throw new Error("anchored directory is closed");
    return `/proc/self/fd/${this.descriptor}`;
  }

  openDirectory(name: string, options: OpenAnchoredDirectoryOptions = {}): AnchoredDirectory {
    const path = this.child(name);
    if (options.create) {
      try { mkdirSync(path, { mode: options.mode ?? 0o755 }); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST" || options.exclusive) throw error;
      }
    }
    return new AnchoredDirectory(openDirectoryAt(this.descriptor, name));
  }

  fsync(): void {
    fsyncSync(this.descriptor);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    closeSync(this.descriptor);
  }
}

export function openAnchoredDirectory(path: string, options: OpenAnchoredDirectoryOptions = {}): AnchoredDirectory {
  if (process.platform !== "linux" || !existsSync("/proc/self/fd")) {
    throw new Error("descriptor-anchored storage requires Linux procfs");
  }
  const absolute = resolve(path);
  if (!isAbsolute(absolute)) throw new Error(`anchored path must be absolute: ${path}`);
  const filesystemRoot = parse(absolute).root;
  const segments = relative(filesystemRoot, absolute).split(sep).filter(Boolean);
  let current = new AnchoredDirectory(openSync(filesystemRoot, constants.O_RDONLY | (constants.O_DIRECTORY ?? 0) | constants.O_NOFOLLOW));
  try {
    for (const segment of segments) {
      const nextPath = current.child(segment);
      if (options.create) {
        try { mkdirSync(nextPath, { mode: options.mode ?? 0o755 }); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        }
      }
      const next = new AnchoredDirectory(openDirectoryAt(current.descriptor, segment));
      current.close();
      current = next;
    }
    return current;
  } catch (error) {
    current.close();
    throw error;
  }
}
