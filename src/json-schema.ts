type Schema = Record<string, unknown>;

const RFC3339_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d+))?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export function isRfc3339DateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1]!;
}

function instantParts(value: string): { epochSecond: number; fraction: string } {
  const match = RFC3339_DATE_TIME.exec(value);
  if (!match || !isRfc3339DateTime(value)) throw new Error(`invalid RFC 3339 date-time: ${value}`);
  const wholeSecond = value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, "");
  const epochSecond = Date.parse(wholeSecond) / 1_000;
  if (!Number.isSafeInteger(epochSecond)) throw new Error(`unsupported RFC 3339 date-time: ${value}`);
  return { epochSecond, fraction: (match[7] ?? "").replace(/0+$/, "") };
}

export function compareRfc3339Instants(left: string, right: string): number {
  const leftParts = instantParts(left);
  const rightParts = instantParts(right);
  if (leftParts.epochSecond !== rightParts.epochSecond) return leftParts.epochSecond < rightParts.epochSecond ? -1 : 1;
  const width = Math.max(leftParts.fraction.length, rightParts.fraction.length);
  const leftFraction = leftParts.fraction.padEnd(width, "0");
  const rightFraction = rightParts.fraction.padEnd(width, "0");
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

export function compareRfc3339EventOrder(leftAt: string, leftId: string, rightAt: string, rightId: string): number {
  return compareRfc3339Instants(leftAt, rightAt) || leftId.localeCompare(rightId);
}

export function rfc3339InstantKey(value: string): string {
  const parts = instantParts(value);
  return `${parts.epochSecond}:${parts.fraction || "0"}`;
}

function pointer(root: Schema, ref: string): Schema | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let value: unknown = root;
  for (const raw of ref.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value && typeof value === "object" ? value as Schema : undefined;
}

function validateNode(value: unknown, schema: Schema, root: Schema, path: string): string[] {
  const errors: string[] = [];
  if (typeof schema.$ref === "string") {
    const target = pointer(root, schema.$ref);
    return target ? validateNode(value, target, root, path) : [`${path}: unresolved schema reference ${schema.$ref}`];
  }
  if (Array.isArray(schema.allOf)) for (const child of schema.allOf) errors.push(...validateNode(value, child as Schema, root, path));
  if (Array.isArray(schema.oneOf)) {
    const branches = schema.oneOf.map((child) => validateNode(value, child as Schema, root, path));
    const matches = branches.filter((child) => child.length === 0);
    if (matches.length !== 1) {
      errors.push(`${path}: must match exactly one event schema`);
      if (matches.length === 0) {
        const closest = [...branches].sort((left, right) => left.length - right.length)[0];
        if (closest) errors.push(...closest);
      }
    }
  }
  if (Object.hasOwn(schema, "const") && !Object.is(value, schema.const)) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => Object.is(entry, value))) errors.push(`${path}: must be one of ${schema.enum.join(", ")}`);
  if (schema.type === "object" || schema.properties !== undefined || schema.required !== undefined) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (schema.type === "object") errors.push(`${path}: must be an object`);
      return errors;
    }
    const object = value as Record<string, unknown>;
    if (Array.isArray(schema.required)) for (const required of schema.required as string[]) if (!Object.hasOwn(object, required)) errors.push(`${path}.${required}: is required`);
    const properties = schema.properties as Record<string, Schema> | undefined;
    if (properties) {
      for (const [key, child] of Object.entries(properties)) if (Object.hasOwn(object, key)) errors.push(...validateNode(object[key], child, root, `${path}.${key}`));
      if (schema.additionalProperties === false) for (const key of Object.keys(object)) if (!Object.hasOwn(properties, key)) errors.push(`${path}.${key}: additional property is not allowed`);
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [...errors, `${path}: must be an array`];
    if (typeof schema.minItems === "number" && value.length < schema.minItems) errors.push(`${path}: must have at least ${schema.minItems} items`);
    if (schema.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${path}: items must be unique`);
    if (schema.items && typeof schema.items === "object") value.forEach((item, index) => errors.push(...validateNode(item, schema.items as Schema, root, `${path}[${index}]`)));
  } else if (schema.type === "string") {
    if (typeof value !== "string") return [...errors, `${path}: must be a string`];
    if (typeof schema.minLength === "number" && value.length < schema.minLength) errors.push(`${path}: must not be empty`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match required pattern`);
    if (schema.format === "date-time" && !isRfc3339DateTime(value)) errors.push(`${path}: must be an RFC 3339 date-time`);
  } else if (schema.type === "boolean" && typeof value !== "boolean") errors.push(`${path}: must be a boolean`);
  return errors;
}

export function validateJsonSchema(value: unknown, schema: Schema): string[] {
  return validateNode(value, schema, schema, "$");
}
