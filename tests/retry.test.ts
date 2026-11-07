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

  test("rejects values that are neither delta-seconds nor an HTTP-date", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(parseRetryAfter("1.5", now)).toBeNull();
    expect(parseRetryAfter("-1", now)).toBeNull();
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("  ", now)).toBeNull();
    expect(parseRetryAfter("2030-01-01T00:00:00Z", now)).toBeNull();
    expect(parseRetryAfter("Sun, 99 Nov 1994 08:49:37 GMT", now)).toBeNull();
  });

  test("keeps delta-seconds behaviour", () => {
    expect(parseRetryAfter("120", new Date("2026-11-07T12:00:00Z"))).toBe(120);
  });

  test("accepts an IMF-fixdate", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(parseRetryAfter("Sat, 07 Nov 2026 12:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter("Sat, 07 Nov 2026 11:58:30 GMT", now)).toBe(0);
    expect(parseRetryAfter("  sat, 07 nov 2026 12:01:30 gmt ", now)).toBe(90);
  });

  test("accepts the obsolete RFC 850 form", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(parseRetryAfter("Saturday, 07-Nov-26 12:01:00 GMT", now)).toBe(60);
  });

  test("accepts the obsolete asctime form as GMT", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(parseRetryAfter("Sat Nov  7 12:02:00 2026", now)).toBe(120);
    expect(parseRetryAfter("Sat Dec 12 12:00:00 2026", new Date("2026-12-12T11:59:00Z"))).toBe(60);
  });
});

describe("RetryPolicy", () => {
  test("the policy validates its options", () => {
    expect(() => new RetryPolicy({ maxAttempts: 0 })).toThrow(InvalidArgumentError);
    expect(() => new RetryPolicy({ maxRetryAfter: -1 })).toThrow(InvalidArgumentError);
  });

  test("maxAttempts must be a finite integer", () => {
    for (const maxAttempts of [NaN, 2.5, Infinity]) {
      expect(() => new RetryPolicy({ maxAttempts })).toThrow(
        "maxAttempts must be an integer of at least 1.",
      );
    }
  });

  test("maxRetryAfter must be finite and not negative", () => {
    for (const maxRetryAfter of [NaN, Infinity, -1]) {
      expect(() => new RetryPolicy({ maxRetryAfter })).toThrow(
        "maxRetryAfter must be a finite number that is not negative.",
      );
    }
  });

  test("delay schedules must hold finite, non-negative numbers", () => {
    expect(() => new RetryPolicy({ concurrencyDelays: [1, NaN] })).toThrow(/concurrencyDelays/);
    expect(() => new RetryPolicy({ rateLimitDelays: [5, -1] })).toThrow(/rateLimitDelays/);
    expect(() => new RetryPolicy({ rateLimitDelays: [NaN] })).toThrow(InvalidArgumentError);
    expect(() => new RetryPolicy({ concurrencyDelays: [-1] })).toThrow(InvalidArgumentError);
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
