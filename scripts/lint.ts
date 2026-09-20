import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const included = new Set([".ts", ".tsx", ".css", ".html", ".json", ".md"]);
const ignored = new Set(["node_modules", "dist", ".git", ".omx", ".omc"]);
const failures: string[] = [];

function visit(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!included.has(extname(entry.name))) continue;
    const content = readFileSync(path, "utf8");
    const label = relative(root, path);
    if (content.length > 0 && !content.endsWith("\n")) failures.push(`${label}: missing trailing newline`);
    if (content.includes("\r")) failures.push(`${label}: CRLF is not allowed`);
    content.split("\n").forEach((line, index) => {
      if (/\s+$/.test(line)) failures.push(`${label}:${index + 1}: trailing whitespace`);
    });
    if (extname(entry.name) === ".json") {
      try { JSON.parse(content); } catch (error) { failures.push(`${label}: invalid JSON (${String(error)})`); }
    }
  }
}

visit(root);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("lint: ok\n");
