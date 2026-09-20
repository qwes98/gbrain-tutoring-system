import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fsyncDirectory } from "./atomic-file.ts";
import { compareRfc3339Instants, rfc3339InstantKey } from "./json-schema.ts";
import { assertContainedPath } from "./path-safety.ts";
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

interface LockOwner {
  token: string;
  ticket?: number;
  pid: number;
  process_identity: string | null;
  acquired_at: number;
}

export interface ReclaimLockOptions {
  staleAfterMs?: number;
  now?: number;
  beforeReclaim?: (entryPath: string, owner: LockOwner) => void;
  afterOwnershipCheck?: (entryPath: string, owner: LockOwner) => void;
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

function lockDirectory(ledgerPath: string): string {
  return `${ledgerPath}.lock`;
}

function readLockOwner(path: string): LockOwner | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
    if (typeof value.token !== "string" || typeof value.pid !== "number" || typeof value.acquired_at !== "number") return null;
    if (value.process_identity !== null && typeof value.process_identity !== "string") return null;
    if (value.ticket !== undefined && (!Number.isSafeInteger(value.ticket) || value.ticket < 1)) return null;
    return value as LockOwner;
  } catch { return null; }
}

function ownerIsStale(owner: LockOwner, now: number, staleAfterMs: number): boolean {
  if (now - owner.acquired_at <= staleAfterMs) return false;
  if (!processExists(owner.pid)) return true;
  const currentIdentity = processIdentity(owner.pid);
  return owner.process_identity !== null && currentIdentity !== null && owner.process_identity !== currentIdentity;
}

export function reclaimStaleLedgerLocks(ledgerPath: string, options: ReclaimLockOptions = {}): void {
  const containmentRoot = ledgerContainmentRoot(ledgerPath);
  const directory = lockDirectory(resolve(ledgerPath));
  assertContainedPath(containmentRoot, directory);
  if (!existsSync(directory)) return;
  const now = options.now ?? Date.now();
  const staleAfterMs = options.staleAfterMs ?? STALE_LOCK_MS;
  for (const name of readdirSync(directory).sort()) {
    if (!name.startsWith("choosing-") && !name.startsWith("ticket-")) continue;
    const entryPath = join(directory, name);
    assertContainedPath(containmentRoot, entryPath);
    const owner = readLockOwner(entryPath);
    if (!owner || !ownerIsStale(owner, now, staleAfterMs)) continue;
    options.beforeReclaim?.(entryPath, owner);
    const current = readLockOwner(entryPath);
    if (!current || current.token !== owner.token) continue;
    options.afterOwnershipCheck?.(entryPath, owner);
    try { unlinkSync(entryPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function writeLockEntry(path: string, owner: LockOwner): void {
  const pending = join(dirname(path), `.pending-${owner.token}-${crypto.randomUUID()}`);
  try {
    writeFileSync(pending, JSON.stringify(owner), { flag: "wx", mode: 0o600 });
    linkSync(pending, path);
    unlinkSync(pending);
  } catch (error) {
    try { if (existsSync(pending)) unlinkSync(pending); } catch { }
    throw error;
  }
}

function lockEntries(directory: string, prefix: "choosing-" | "ticket-"): Array<{ path: string; owner: LockOwner }> {
  return readdirSync(directory)
    .filter((name) => name.startsWith(prefix))
    .sort()
    .flatMap((name) => {
      const path = join(directory, name);
      const owner = readLockOwner(path);
      return owner ? [{ path, owner }] : [];
    });
}

async function acquireLock(ledgerPath: string): Promise<() => void> {
  const containmentRoot = ledgerContainmentRoot(ledgerPath);
  const directory = lockDirectory(resolve(ledgerPath));
  assertContainedPath(containmentRoot, directory);
  mkdirSync(directory, { recursive: true });
  assertContainedPath(containmentRoot, directory);
  const started = Date.now();
  const token = crypto.randomUUID();
  const identity = processIdentity(process.pid);
  const choosingPath = join(directory, `choosing-${token}.json`);
  let ticketPath: string | null = null;
  try {
    writeLockEntry(choosingPath, { token, pid: process.pid, process_identity: identity, acquired_at: Date.now() });
    reclaimStaleLedgerLocks(ledgerPath);
    const maximum = lockEntries(directory, "ticket-").reduce((current, entry) => Math.max(current, entry.owner.ticket ?? 0), 0);
    const ticket = maximum + 1;
    ticketPath = join(directory, `ticket-${String(ticket).padStart(12, "0")}-${token}.json`);
    writeLockEntry(ticketPath, { token, ticket, pid: process.pid, process_identity: identity, acquired_at: Date.now() });
    unlinkSync(choosingPath);

    while (true) {
      reclaimStaleLedgerLocks(ledgerPath);
      const anotherChoosing = lockEntries(directory, "choosing-").some((entry) => entry.owner.token !== token);
      const tickets = lockEntries(directory, "ticket-")
        .sort((left, right) => (left.owner.ticket ?? 0) - (right.owner.ticket ?? 0) || left.owner.token.localeCompare(right.owner.token));
      if (!anotherChoosing && tickets[0]?.owner.token === token) break;
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`timed out acquiring ledger lock: ${ledgerPath}`);
      await Bun.sleep(10);
    }
  } catch (error) {
    try { if (existsSync(choosingPath)) unlinkSync(choosingPath); } catch { }
    try { if (ticketPath && existsSync(ticketPath)) unlinkSync(ticketPath); } catch { }
    throw error;
  }

  const ownedTicketPath = ticketPath;
  return () => {
    if (!ownedTicketPath) return;
    const owner = readLockOwner(ownedTicketPath);
    if (owner?.token !== token) return;
    try { unlinkSync(ownedTicketPath); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
}

function decodeLedger(path: string): string {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = readFileSync(descriptor);
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
      throw new Error(`ledger contains invalid UTF-8: ${path}`);
    }
  } finally { closeSync(descriptor); }
}

export function readLedger(path: string, options: ReadLedgerOptions = {}): ReadLedgerResult {
  const containmentRoot = options.containmentRoot ?? ledgerContainmentRoot(path);
  assertContainedPath(containmentRoot, path);
  if (!existsSync(path)) return { events: [], recovered_truncated_tail: false, truncated_tail: null };
  const raw = decodeLedger(path);
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

export async function appendEvent(path: string, event: LedgerEvent): Promise<void> {
  assertEvent(event);
  const containmentRoot = ledgerContainmentRoot(path);
  assertContainedPath(containmentRoot, path);
  mkdirSync(dirname(path), { recursive: true });
  assertContainedPath(containmentRoot, path);
  const release = await acquireLock(path);
  try {
    const current = readLedger(path, { containmentRoot });
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
    for (const validationTime of validationTimes) {
      projectEvents(candidateEvents, { asOf: validationTime });
    }
    const line = Buffer.from(`${JSON.stringify(event)}\n`);
    const existed = existsSync(path);
    const descriptor = openSync(path, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o644);
    try {
      let offset = 0;
      while (offset < line.length) {
        const written = writeSync(descriptor, line, offset, line.length - offset);
        if (written <= 0) throw new Error(`short append at offset ${offset}/${line.length}`);
        offset += written;
      }
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (!existed) fsyncDirectory(dirname(path));
  } finally {
    release();
  }
}
