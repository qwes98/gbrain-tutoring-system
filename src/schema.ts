import ledgerEventSchema from "../schemas/ledger-event.schema.json";
import { validateJsonSchema } from "./json-schema.ts";
import type { LedgerEvent, ValidationResult } from "./types.ts";

export function validateEvent(value: unknown): ValidationResult {
  const errors = validateJsonSchema(value, ledgerEventSchema);
  return { valid: errors.length === 0, errors };
}

export function assertEvent(value: unknown): asserts value is LedgerEvent {
  const result = validateEvent(value);
  if (!result.valid) throw new Error(`invalid ledger event: ${result.errors.join("; ")}`);
}
