import { readFile } from "node:fs/promises";

export const events = readFile("events.jsonl", "utf8");
