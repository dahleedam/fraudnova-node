import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const FORBIDDEN = [
  ["IP", "Quality", "Score"].join(""),
  ["IP", "QS"].join(""),
  "upstream " + "key",
  "key " + "pool",
];
const SKIP = new Set([".git", "node_modules", "dist", "coverage", ".superpowers"]);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) files.push(...walk(join(dir, entry.name)));
    } else if (entry.isFile()) {
      files.push(join(dir, entry.name));
    }
  }
  return files;
}

test("no file names the upstream provider", () => {
  const needles = FORBIDDEN.map((n) => n.toLowerCase());
  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const text = readFileSync(file, "utf8").toLowerCase();
    for (const needle of needles) {
      if (text.includes(needle)) offenders.push(`${relative(ROOT, file)}: ${needle}`);
    }
  }
  expect(offenders).toEqual([]);
});
