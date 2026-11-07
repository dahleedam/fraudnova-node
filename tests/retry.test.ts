import { afterEach, describe, expect, test, vi } from "vitest";
import { InvalidArgumentError, RateLimitError } from "../src/errors.js";
import { RetryPolicy, parseRetryAfter } from "../src/retry.js";

const concurrency = (retryAfter: number | null = null) =>
  new RateLimitError(
    429,
    "Too many concurrent requests for this account. Please retry.",
    {},
    retryAfter,
  );
const rate = (retryAfter: number | null = null) =>
  new RateLimitError(429, "Rate limit exceeded. Try again shortly.", {}, retryAfter);

afterEach(() => {
  vi.useRealTimers();
});

describe("parseRetryAfter", () => {
  test("parses delta seconds and HTTP dates", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(parseRetryAfter("5", now)).toBe(5);
    expect(parseRetryAfter(" 12 ", now)).toBe(12);
    expect(parseRetryAfter(new Date(now.getTime() + 30_000).toUTCString(), now)).toBe(30);
    expect(parseRetryAfter(new Date(now.getTime() - 30_000).toUTCString(), now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe("RetryPolicy", () => {
  test("the policy validates its options", () => {
    expect(() => new RetryPolicy({ maxAttempts: 0 })).toThrow(InvalidArgumentError);
    expect(() => new RetryPolicy({ maxRetryAfter: -1 })).toThrow(InvalidArgumentError);
  });

  test("delayFor uses the schedules", () => {
    const policy = new RetryPolicy();
    expect(policy.delayFor(concurrency(), 1)).toBe(1);
    expect(policy.delayFor(concurrency(), 2)).toBe(2);
    expect(policy.delayFor(rate(), 1)).toBe(5);
    expect(policy.delayFor(rate(), 2)).toBe(15);
    expect(policy.delayFor(rate(), 3)).toBeNull();
  });

  test("delayFor honours Retry-After", () => {
    expect(new RetryPolicy().delayFor(rate(7), 1)).toBe(7);
  });

  test("delayFor honours a zero Retry-After", () => {
    expect(new RetryPolicy().delayFor(rate(0), 1)).toBe(0);
  });

  test("delayFor stops when Retry-After exceeds the maximum", () => {
    expect(new RetryPolicy({ maxRetryAfter: 60 }).delayFor(rate(120), 1)).toBeNull();
  });

  test("delayFor ignores Retry-After when disabled", () => {
    expect(new RetryPolicy({ honourRetryAfter: false }).delayFor(rate(7), 1)).toBe(5);
  });

  test("schedule exhaustion returns null", () => {
    const policy = new RetryPolicy({ maxAttempts: 10, rateLimitDelays: [5] });
    expect(policy.delayFor(rate(), 2)).toBeNull();
  });

  test("sleep awaits the configured sleeper", async () => {
    const seen: number[] = [];
    const policy = new RetryPolicy({
      sleep: (seconds) => {
        seen.push(seconds);
        return Promise.resolve();
      },
    });
    await policy.sleep(2.5);
    expect(seen).toEqual([2.5]);
  });

  test("the default sleeper resolves after the delay", async () => {
    vi.useFakeTimers();
    const policy = new RetryPolicy();
    const p = policy.sleep(1);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
  });
});
