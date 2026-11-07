import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { FraudNova } from "../src/index.js";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("README only calls methods that exist on FraudNova", () => {
  const called = new Set([...readme.matchAll(/client\.(\w+)\(/g)].map((m) => m[1]));
  expect(called.size).toBeGreaterThan(0);
  const proto = FraudNova.prototype as unknown as Record<string, unknown>;
  const missing = [...called].filter((name) => typeof proto[name] !== "function");
  expect(missing).toEqual([]);
});

test("README mentions install and every method", () => {
  const required = [
    "npm install @fraudnova/sdk",
    'const { FraudNova } = require("@fraudnova/sdk");',
    "checkIp",
    "checkEmail",
    "checkPhone",
    "checkIps",
    "checkEmails",
    "checkPhones",
    "balance",
    "myIp",
    "flagged",
    "flagReasons",
    "RetryPolicy",
    "creditsRemaining",
    "BATCH_MAX",
    "retryAfter",
    "isConcurrencyLimit",
    "creditRefunded",
    "cause",
  ];
  const missing = required.filter((needle) => !readme.includes(needle));
  expect(missing).toEqual([]);
});
