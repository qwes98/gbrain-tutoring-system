import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dlopen } from "bun:ffi";
import { basename, dirname, resolve } from "node:path";
import { type AnchoredDirectory, openAnchoredDirectory } from "./anchored-fs.ts";
import { compareRfc3339Instants, rfc3339InstantKey } from "./json-schema.ts";
import { assertLexicallyContainedPath } from "./path-safety.ts";
import { projectEvents } from "./projection.ts";
import { assertEvent } from "./schema.ts";
import type { LedgerEvent } from "./types.ts";

const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;

export interface ReadLedgerOptions {
  truncatedTail?: "fail" | "recover";
  containmentRoot?: string;
}
export interface ReadLedgerResult { events: LedgerEvent[]; recovered_truncated_tail: boolean; truncated_tail: string | null; }
export interface LedgerTransaction<T> { event?: LedgerEvent; value: T; }
export interface LedgerTransactionOptions { afterLedgerParentOpen?: () => void; }

export interface AppendOnlyRecord { id: string; }
export interface AppendOnlyTransaction<TRecord extends AppendOnlyRecord, TValue> { record?: TRecord; value: TValue; }

interface LockOwner {
  token: string;
  ticket?: number;
  pid: number;
  process_identity: string | null;
  acquired_at: number;
}

interface LockSnapshot {
  owner: LockOwner;
  identity: string;
  content: string;
}

interface LockHandle extends LockSnapshot {
  descriptor: number;
}

export interface ReclaimLockOptions {
  staleAfterMs?: number;
  now?: number;
  beforeReclaim?: (entryPath: string, owner: LockOwner) => void;
  afterOwnershipCheck?: (entryPath: string, owner: LockOwner) => void;
  afterClaim?: (entryPath: string, owner: LockOwner) => void;
}

function ledgerContainmentRoot(path: string): string {
  const parent = dirname(resolve(path));
  return basename(parent) === "ledger" ? dirname(parent) : parent;
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function processIdentity(pid: number): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).trim().split(/\s+/);
      const startTicks = fields[19];
      return startTicks ? `linux-start-ticks:${startTicks}` : null;
    } catch { return null; }
  }
  try {
    const result = Bun.spawnSync(["ps", "-o", "lstart=", "-p", String(pid)]);
    if (result.exitCode !== 0) return null;
    const started = new TextDecoder().decode(result.stdout).trim();
    return started ? `ps-start:${started}` : null;
  } catch { return null; }
}

function parseLockOwner(value: unknown): LockOwner | null {
  if (!value || typeof value !== "object") return null;
  const owner = value as Partial<LockOwner>;
  if (typeof owner.token !== "string" || typeof owner.pid !== "number" || typeof owner.acquired_at !== "number") return null;
  if (owner.process_identity !== null && typeof owner.process_identity !== "string") return null;
  if (owner.ticket !== undefined && (!Number.isSafeInteger(owner.ticket) || owner.ticket < 1)) return null;
  return owner as LockOwner;
}

function openLockHandle(directory: AnchoredDirectory, name: string): LockHandle | null {
  let descriptor: number;
  try { descriptor = openSync(directory.child(name), constants.O_RDONLY | constants.O_NOFOLLOW); } catch { return null; }
  try {
    const content = readFileSync(descriptor, "utf8");
    const owner = parseLockOwner(JSON.parse(content));
    if (!owner) {
      closeSync(descriptor);
      return null;
    }
    const stat = fstatSync(descriptor, { bigint: true });
    return { owner, identity: `${stat.dev}:${stat.ino}`, content, descriptor };
  } catch {
    closeSync(descriptor);
    return null;
  }
}

function readLockSnapshot(directory: AnchoredDirectory, name: string): LockSnapshot | null {
  const handle = openLockHandle(directory, name);
  if (!handle) return null;
  try { return { owner: handle.owner, identity: handle.identity, content: handle.content }; } finally { closeSync(handle.descriptor); }
}

function sameLock(left: LockSnapshot, right: LockSnapshot): boolean {
  return left.owner.token === right.owner.token && left.identity === right.identity && left.content === right.content;
}

function ownerIsStale(owner: LockOwner, now: number, staleAfterMs: number): boolean {
  if (now - owner.acquired_at <= staleAfterMs) return false;
  if (!processExists(owner.pid)) return true;
  const currentIdentity = processIdentity(owner.pid);
  return owner.process_identity !== null && currentIdentity !== null && owner.process_identity !== currentIdentity;
}

function restoreMovedReplacement(directory: AnchoredDirectory, originalName: string, claimName: string): void {
  try {
    linkSync(directory.child(claimName), directory.child(originalName));
    unlinkSync(directory.child(claimName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

function removeLockIfOwned(directory: AnchoredDirectory, name: string, expected: LockSnapshot, options: ReclaimLockOptions = {}): boolean {
  const claimName = `.reclaim-${options.now ?? Date.now()}-${crypto.randomUUID()}.json`;
  try { renameSync(directory.child(name), directory.child(claimName)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  options.afterClaim?.(directory.child(name), expected.owner);
  const claimed = readLockSnapshot(directory, claimName);
  if (claimed && sameLock(claimed, expected)) {
    unlinkSync(directory.child(claimName));
    return true;
  }
  restoreMovedReplacement(directory, name, claimName);
  return false;
}

function cleanupReclaimClaims(directory: AnchoredDirectory, now: number, staleAfterMs: number): void {
  for (const name of readdirSync(directory.path()).sort()) {
    const match = /^\.reclaim-(\d+)-[0-9a-f-]+\.json$/.exec(name);
    if (!match || now - Number(match[1]) <= staleAfterMs) continue;
    const handle = openLockHandle(directory, name);
    if (!handle) continue;
    try { removeLockIfOwned(directory, name, handle, { now }); } finally { closeSync(handle.descriptor); }
  }
}

function reclaimStaleLocks(directory: AnchoredDirectory, options: ReclaimLockOptions = {}): void {
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? STALE_LOCK_MS;
  cleanupReclaimClaims(directory, now, staleAfterMs);
  for (const name of readdirSync(directory.path()).sort()) {
    if (!name.startsWith("choosing-") && !name.startsWith("ticket-")) continue;
    const handle = openLockHandle(directory, name);
    if (!handle) continue;
    try {
      if (!ownerIsStale(handle.owner, now, staleAfterMs)) continue;
      const entryPath = directory.child(name);
      options.beforeReclaim?.(entryPath, handle.owner);
      const current = readLockSnapshot(directory, name);
      if (!current || !sameLock(current, handle)) continue;
      options.afterOwnershipCheck?.(entryPath, handle.owner);
      removeLockIfOwned(directory, name, handle, options);
    } finally { closeSync(handle.descriptor); }
  }
}

export function reclaimStaleLedgerLocks(ledgerPath: string, options: ReclaimLockOptions = {}): void {
  const absolute = resolve(ledgerPath);
  assertLexicallyContainedPath(ledgerContainmentRoot(absolute), absolute);
  let ledgerDirectory: AnchoredDirectory;
  try { ledgerDirectory = openAnchoredDirectory(dirname(absolute)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let lockDirectory: AnchoredDirectory | null = null;
  try {
    try { lockDirectory = ledgerDirectory.openDirectory(`${basename(absolute)}.lock`); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    reclaimStaleLocks(lockDirectory, options);
  } finally {
    lockDirectory?.close();
    ledgerDirectory.close();
  }
}

function writeLockEntry(directory: AnchoredDirectory, name: string, owner: LockOwner): LockHandle {
  const pendingName = `.pending-${owner.token}-${crypto.randomUUID()}`;
  try {
    writeFileSync(directory.child(pendingName), JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    linkSync(directory.child(pendingName), directory.child(name));
    unlinkSync(directory.child(pendingName));
    const handle = openLockHandle(directory, name);
    if (!handle) throw new Error(`failed to publish ledger lock: ${name}`);
    return handle;
  } catch (error) {
    try { if (existsSync(directory.child(pendingName))) unlinkSync(directory.child(pendingName)); } catch { }
    throw error;
  }
}

function lockEntries(directory: AnchoredDirectory, prefix: "choosing-" | "ticket-"): Array<{ name: string; snapshot: LockSnapshot }> {
  return readdirSync(directory.path())
    .filter((name) => name.startsWith(prefix))
    .sort()
    .flatMap((name) => {
      const snapshot = readLockSnapshot(directory, name);
      return snapshot ? [{ name, snapshot }] : [];
    });
}

async function acquireLock(ledgerPath: string, ledgerDirectory: AnchoredDirectory, ledgerName: string): Promise<() => void> {
  const directory = ledgerDirectory.openDirectory(`${ledgerName}.lock`, { create: true, mode: 0o700 });
  const started = Date.now();
  const token = crypto.randomUUID();
  const identity = processIdentity(process.pid);
  const choosingName = `choosing-${token}.json`;
  let choosingHandle: LockHandle | null = null;
  let ticketName: string | null = null;
  let ticketHandle: LockHandle | null = null;
  try {
    choosingHandle = writeLockEntry(directory, choosingName, { token, pid: process.pid, process_identity: identity, acquired_at: Date.now() });
    reclaimStaleLocks(directory);
    const maximum = lockEntries(directory, "ticket-").reduce((current, entry) => Math.max(current, entry.snapshot.owner.ticket ?? 0), 0);
    const ticket = maximum + 1;
    ticketName = `ticket-${String(ticket).padStart(12, "0")}-${token}.json`;
    ticketHandle = writeLockEntry(directory, ticketName, { token, ticket, pid: process.pid, process_identity: identity, acquired_at: Date.now() });
    removeLockIfOwned(directory, choosingName, choosingHandle);
    closeSync(choosingHandle.descriptor);
    choosingHandle = null;

    while (true) {
      reclaimStaleLocks(directory);
      const anotherChoosing = lockEntries(directory, "choosing-").some((entry) => entry.snapshot.owner.token !== token);
      const tickets = lockEntries(directory, "ticket-")
        .sort((left, right) => (left.snapshot.owner.ticket ?? 0) - (right.snapshot.owner.ticket ?? 0)
          || left.snapshot.owner.token.localeCompare(right.snapshot.owner.token));
      if (!anotherChoosing && tickets[0]?.snapshot.owner.token === token) break;
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`timed out acquiring ledger lock: ${ledgerPath}`);
      await Bun.sleep(10);
    }
  } catch (error) {
    if (choosingHandle) {
      try { removeLockIfOwned(directory, choosingName, choosingHandle); } catch { }
      try { closeSync(choosingHandle.descriptor); } catch { }
    }
    if (ticketName && ticketHandle) {
      try { removeLockIfOwned(directory, ticketName, ticketHandle); } catch { }
      try { closeSync(ticketHandle.descriptor); } catch { }
    }
    try { directory.close(); } catch { }
    throw error;
  }

  const ownedTicketName = ticketName;
  const ownedTicketHandle = ticketHandle;
  return () => {
    try {
      if (ownedTicketName && ownedTicketHandle) removeLockIfOwned(directory, ownedTicketName, ownedTicketHandle);
    } finally {
      if (ownedTicketHandle) closeSync(ownedTicketHandle.descriptor);
      directory.close();
    }
  };
}

function decodeLedgerDescriptor(descriptor: number, path: string): string {
  const bytes = readFileSync(descriptor);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    throw new Error(`ledger contains invalid UTF-8: ${path}`);
  }
}

function parseLedger(raw: string, path: string, options: ReadLedgerOptions): ReadLedgerResult {
  if (raw.length === 0) return { events: [], recovered_truncated_tail: false, truncated_tail: null };
  const hasTruncatedTail = !raw.endsWith("\n");
  if (hasTruncatedTail && options.truncatedTail !== "recover") {
    throw new Error(`ledger has an unterminated final record: ${path}`);
  }
  const lines = raw.split("\n");
  const truncatedTail = hasTruncatedTail ? lines.pop() ?? "" : null;
  if (!hasTruncatedTail) lines.pop();
  const events: LedgerEvent[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) throw new Error(`blank JSONL record at line ${index + 1}: ${path}`);
    let event: unknown;
    try { event = JSON.parse(line); } catch {
      throw new Error(`invalid JSONL at line ${index + 1}: ${path}`);
    }
    assertEvent(event);
    if (ids.has(event.id)) throw new Error(`duplicate event id ${event.id} at line ${index + 1}`);
    ids.add(event.id);
    events.push(event);
  }
  return { events, recovered_truncated_tail: hasTruncatedTail, truncated_tail: truncatedTail };
}

export function readLedger(path: string, options: ReadLedgerOptions = {}): ReadLedgerResult {
  const absolute = resolve(path);
  const containmentRoot = options.containmentRoot ?? ledgerContainmentRoot(absolute);
  assertLexicallyContainedPath(containmentRoot, absolute);
  let directory: AnchoredDirectory;
  try { directory = openAnchoredDirectory(dirname(absolute)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], recovered_truncated_tail: false, truncated_tail: null };
    throw error;
  }
  let descriptor: number;
  try {
    try { descriptor = openSync(directory.child(basename(absolute)), constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { events: [], recovered_truncated_tail: false, truncated_tail: null };
      throw error;
    }
    try { return parseLedger(decodeLedgerDescriptor(descriptor, absolute), absolute, options); } finally { closeSync(descriptor); }
  } finally {
    directory.close();
  }
}

function parseAppendOnlyRecords<TRecord extends AppendOnlyRecord>(
  raw: string,
  path: string,
  parseRecord: (value: unknown) => TRecord,
): TRecord[] {
  if (raw.length === 0) return [];
  if (!raw.endsWith("\n")) throw new Error(`append-only log has an unterminated final record: ${path}`);
  const records: TRecord[] = [];
  const ids = new Set<string>();
  const lines = raw.slice(0, -1).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.length === 0) throw new Error(`blank JSONL record at line ${index + 1}: ${path}`);
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`invalid JSONL at line ${index + 1}: ${path}`); }
    const record = parseRecord(value);
    if (ids.has(record.id)) throw new Error(`duplicate record id ${record.id} at line ${index + 1}`);
    ids.add(record.id);
    records.push(record);
  }
  return records;
}

export function readAppendOnlyJsonl<TRecord extends AppendOnlyRecord>(
  path: string,
  parseRecord: (value: unknown) => TRecord,
): TRecord[] {
  const absolute = resolve(path);
  assertLexicallyContainedPath(ledgerContainmentRoot(absolute), absolute);
  let directory: AnchoredDirectory;
  try { directory = openAnchoredDirectory(dirname(absolute)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  try {
    let descriptor: number;
    try { descriptor = openSync(directory.child(basename(absolute)), constants.O_RDONLY | constants.O_NOFOLLOW); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    try { return parseAppendOnlyRecords(decodeLedgerDescriptor(descriptor, absolute), absolute, parseRecord); }
    finally { closeSync(descriptor); }
  } finally { directory.close(); }
}

function validateAppend(current: ReadLedgerResult, event: LedgerEvent): void {
  assertEvent(event);
  if (current.events.some((existing) => existing.id === event.id)) throw new Error(`duplicate event id: ${event.id}`);
  if (event.type === "event.corrected") {
    const data = event.data as { corrects_event_id?: string; replacement_data?: Record<string, unknown> };
    const target = current.events.find((existing) => existing.id === data.corrects_event_id);
    if (!target) throw new Error(`correction target not found: ${data.corrects_event_id}`);
    if (target.type === "event.corrected") throw new Error("corrections cannot target correction events");
    assertEvent({ ...target, data: data.replacement_data });
  }
  const candidateEvents = [...current.events, event];
  const validationTimes = event.type === "event.corrected"
    ? [...candidateEvents
      .filter((candidate) => compareRfc3339Instants(candidate.occurred_at, event.occurred_at) >= 0)
      .reduce((instants, candidate) => instants.set(rfc3339InstantKey(candidate.occurred_at), candidate.occurred_at), new Map<string, string>())
      .values()]
      .sort(compareRfc3339Instants)
    : [candidateEvents.map((candidate) => candidate.occurred_at).sort(compareRfc3339Instants).at(-1)!];
  for (const validationTime of validationTimes) projectEvents(candidateEvents, { asOf: validationTime });
}

function openLedgerForTransaction(directory: AnchoredDirectory, name: string): { descriptor: number; created: boolean } {
  try {
    return { descriptor: openSync(directory.child(name), constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW), created: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    return {
      descriptor: openSync(directory.child(name), constants.O_RDWR | constants.O_APPEND | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644),
      created: true,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return { descriptor: openSync(directory.child(name), constants.O_RDWR | constants.O_APPEND | constants.O_NOFOLLOW), created: false };
  }
}

const openLibc = () => dlopen("libc.so.6", {
  flock: { args: ["i32", "i32"], returns: "i32" } as const,
});
let libc: ReturnType<typeof openLibc> | null = null;
function nativeLedgerLock(): ReturnType<typeof openLibc> {
  if (process.platform !== "linux") throw new Error("ledger inode locking requires Linux");
  return libc ??= openLibc();
}
const LOCK_EXCLUSIVE_NONBLOCKING = 2 | 4;
const LOCK_UN = 8;

async function acquireLedgerInodeLock(descriptor: number, path: string): Promise<() => void> {
  const started = Date.now();
  while (nativeLedgerLock().symbols.flock(descriptor, LOCK_EXCLUSIVE_NONBLOCKING) !== 0) {
    if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`timed out acquiring ledger inode lock: ${path}`);
    await Bun.sleep(10);
  }
  return () => {
    if (nativeLedgerLock().symbols.flock(descriptor, LOCK_UN) !== 0) throw new Error(`failed to release ledger inode lock: ${path}`);
  };
}

export async function transactAppendOnlyJsonl<TRecord extends AppendOnlyRecord, TValue>(
  path: string,
  parseRecord: (value: unknown) => TRecord,
  validateCandidate: (current: readonly TRecord[], record: TRecord) => void,
  transaction: (records: readonly TRecord[]) => AppendOnlyTransaction<TRecord, TValue>,
  options: LedgerTransactionOptions = {},
): Promise<TValue> {
  const absolute = resolve(path);
  const containmentRoot = ledgerContainmentRoot(absolute);
  assertLexicallyContainedPath(containmentRoot, absolute);
  const directory = openAnchoredDirectory(dirname(absolute), { create: true });
  let release: (() => void) | null = null;
  let releaseInode: (() => void) | null = null;
  let descriptor: number | null = null;
  let value!: TValue;
  let failed = false;
  let failure: unknown;
  try {
    options.afterLedgerParentOpen?.();
    const opened = openLedgerForTransaction(directory, basename(absolute));
    descriptor = opened.descriptor;
    releaseInode = await acquireLedgerInodeLock(descriptor, absolute);
    release = await acquireLock(absolute, directory, basename(absolute));
    const current = parseAppendOnlyRecords(decodeLedgerDescriptor(descriptor, absolute), absolute, parseRecord);
    const selected = transaction(current);
    if (selected.record) {
      const record = parseRecord(selected.record);
      validateCandidate(current, record);
      if (current.some((existing) => existing.id === record.id)) throw new Error(`duplicate record id: ${record.id}`);
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      let offset = 0;
      while (offset < line.length) {
        const written = writeSync(descriptor, line, offset, line.length - offset);
        if (written <= 0) throw new Error(`short append at offset ${offset}/${line.length}`);
        offset += written;
      }
      fsyncSync(descriptor);
      if (opened.created) directory.fsync();
    }
    value = selected.value;
  } catch (error) {
    failed = true;
    failure = error;
  }
  let cleanupFailure: unknown;
  const cleanup = (operation: () => void): void => {
    try { operation(); } catch (error) { cleanupFailure ??= error; }
  };
  if (release) cleanup(release);
  if (releaseInode) cleanup(releaseInode);
  if (descriptor !== null) cleanup(() => closeSync(descriptor));
  cleanup(() => directory.close());
  if (failed) throw failure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  return value;
}

export async function transactLedger<T>(
  path: string,
  transaction: (events: readonly LedgerEvent[]) => LedgerTransaction<T>,
  options: LedgerTransactionOptions = {},
): Promise<T> {
  return transactAppendOnlyJsonl(
    path,
    (value) => { assertEvent(value); return value; },
    (events, event) => validateAppend({ events: [...events], recovered_truncated_tail: false, truncated_tail: null }, event),
    (events) => {
      const selected = transaction(events);
      return { ...(selected.event ? { record: selected.event } : {}), value: selected.value };
    },
    options,
  );
}

export async function appendEvent(path: string, event: LedgerEvent, options: LedgerTransactionOptions = {}): Promise<void> {
  await transactLedger(path, () => ({ event, value: undefined }), options);
}
