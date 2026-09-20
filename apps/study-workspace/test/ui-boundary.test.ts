import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

function uiModules(directory: string): Array<{ name: string; content: string }> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return uiModules(path);
    if (!/\.tsx?$/.test(entry.name)) return [];
    return [{ name: path, content: readFileSync(path, "utf8") }];
  });
}

describe("study workspace UI boundary", () => {
  test("UI modules exist and do not import ledger or projection internals", () => {
    const directory = join(import.meta.dir, "..", "src", "ui");
    const modules = uiModules(directory);

    expect(modules.length).toBeGreaterThan(0);
    for (const module of modules) {
      expect(module.content, module.name).not.toMatch(/(?:\.\.\/){3,}|src\/(?:ledger|projection|topic)|events\.jsonl|projections\/generations/);
    }
    expect(modules.some((module) => module.content.includes("aria-pressed"))).toBe(true);
  });
});
