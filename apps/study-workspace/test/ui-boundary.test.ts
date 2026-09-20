import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

interface SourceModule {
  name: string;
  content: string;
}

const appSource = join(import.meta.dir, "..", "src");

function importSpecifiers(content: string): string[] {
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  return patterns.flatMap((pattern) => Array.from(content.matchAll(pattern), (match) => match[1]!));
}

function boundaryViolations(module: SourceModule): string[] {
  const violations: string[] = [];
  if (/\bBun\.(?:file|write)\s*\(/.test(module.content)) violations.push("direct filesystem access");
  if (/events\.jsonl|projections[\\/]generations/.test(module.content)) violations.push("direct ledger or projection storage access");

  for (const specifier of importSpecifiers(module.content)) {
    if (/^(?:node:)?fs(?:\/promises)?$/.test(specifier)) {
      violations.push(`filesystem import: ${specifier}`);
      continue;
    }
    if (/(?:^|[\\/])(?:ledger|projection)(?:\.[cm]?[jt]sx?)?$/.test(specifier)) {
      violations.push(`internal data import: ${specifier}`);
    }
    if (!specifier.startsWith(".")) continue;

    const resolved = resolve(dirname(module.name), specifier).replace(/\.[cm]?[jt]sx?$/, "");
    const relativeToSource = relative(appSource, resolved);
    const escapesApp = relativeToSource === ".." || relativeToSource.startsWith(`..${sep}`);
    if (escapesApp) violations.push(`import escapes application source: ${specifier}`);

    const relativeCore = relative(join(appSource, "core"), resolved);
    const isCoreModule = relativeCore !== ".." && !relativeCore.startsWith(`..${sep}`);
    const isVersionedPort = relativeCore === "tutor-core-port";
    if (isCoreModule && !isVersionedPort) violations.push(`undeclared internal core import: ${specifier}`);
  }

  return violations;
}

function productionModules(directory: string): SourceModule[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionModules(path);
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return [];
    return [{ name: path, content: readFileSync(path, "utf8") }];
  });
}

describe("study workspace UI boundary", () => {
  test("production modules exist and do not import ledger or projection internals", () => {
    const modules = productionModules(appSource);

    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(boundaryViolations(module), module.name).toEqual([]);
    }
    expect(modules.some((module) => module.content.includes("aria-pressed"))).toBe(true);
  });

  test("adversarial fixtures cover the declared lexical boundary patterns", () => {
    const directory = join(import.meta.dir, "fixtures", "boundary");
    const fixtures = readdirSync(directory)
      .filter((name) => name.startsWith("forbidden-"))
      .sort()
      .map((name) => ({ name, content: readFileSync(join(directory, name), "utf8") }));

    expect(fixtures.map((fixture) => fixture.name)).toEqual([
      "forbidden-bun-file.txt",
      "forbidden-generation.txt",
      "forbidden-internal-core.txt",
      "forbidden-ledger.txt",
      "forbidden-node-fs.txt",
      "forbidden-projection.txt",
    ]);
    for (const fixture of fixtures) {
      expect(boundaryViolations({
        name: join(appSource, "nested", fixture.name.replace(/\.txt$/, ".ts")),
        content: fixture.content,
      }), fixture.name).not.toEqual([]);
    }

    const allowed = readFileSync(join(directory, "allowed-versioned-port.txt"), "utf8");
    expect(boundaryViolations({ name: join(appSource, "allowed.ts"), content: allowed })).toEqual([]);
  });

  test("JavaScript production extensions cannot bypass recursive scanning", () => {
    const directory = join(import.meta.dir, "fixtures", "production-boundary-js");
    const modules = productionModules(directory);

    expect(modules.map((module) => module.name.slice(directory.length + 1))).toEqual([
      join("nested", "forbidden-direct-fs.mjs"),
    ]);
    expect(boundaryViolations(modules[0]!)).not.toEqual([]);
  });
});
