import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { VERSION } from "../src/index.js";

function read(name: string): string {
  return readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
}

const pkg = JSON.parse(read("package.json")) as { version: string; dependencies?: unknown };

test("VERSION matches package.json", () => {
  expect(pkg.version).toBe(VERSION);
});

test("VERSION matches the newest CHANGELOG release heading", () => {
  const match = /^## \[(\d+\.\d+\.\d+)\]/m.exec(read("CHANGELOG.md"));
  expect(match?.[1]).toBe(VERSION);
});

test("package.json declares no runtime dependencies", () => {
  expect(pkg.dependencies).toBeUndefined();
});
