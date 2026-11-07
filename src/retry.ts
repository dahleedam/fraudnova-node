import { InvalidArgumentError, type RateLimitError } from "./errors.js";

/** Parse a Retry-After header (delta-seconds or HTTP-date) into whole seconds. */
export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  const when = Date.parse(text);
  if (Number.isNaN(when)) return null;
  return Math.max(0, Math.ceil((when - now.getTime()) / 1000));
}

export interface RetryPolicyOptions {
  maxAttempts?: number;
  concurrencyDelays?: readonly number[];
  rateLimitDelays?: readonly number[];
  honourRetryAfter?: boolean;
  maxRetryAfter?: number;
  sleep?: (seconds: number) => Promise<void>;
}

const defaultSleep = (seconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/** Opt-in retry policy for rate-limited (429) requests. All delays are in seconds. */
export class RetryPolicy {
  readonly maxAttempts: number;
  readonly concurrencyDelays: readonly number[];
  readonly rateLimitDelays: readonly number[];
  readonly honourRetryAfter: boolean;
  readonly maxRetryAfter: number;
  readonly #sleeper: (seconds: number) => Promise<void>;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.concurrencyDelays = [...(options.concurrencyDelays ?? [1, 2, 4])];
    this.rateLimitDelays = [...(options.rateLimitDelays ?? [5, 15, 40])];
    this.honourRetryAfter = options.honourRetryAfter ?? true;
    this.maxRetryAfter = options.maxRetryAfter ?? 60;
    this.#sleeper = options.sleep ?? defaultSleep;
    if (this.maxAttempts < 1) throw new InvalidArgumentError("maxAttempts must be at least 1.");
    if (this.maxRetryAfter < 0)
      throw new InvalidArgumentError("maxRetryAfter must not be negative.");
  }

  /** Seconds to wait before retrying after `attempt` (1-based) failed, or null to stop. */
  delayFor(error: RateLimitError, attempt: number): number | null {
    if (attempt >= this.maxAttempts) return null;
    if (this.honourRetryAfter && error.retryAfter !== null) {
      return error.retryAfter > this.maxRetryAfter ? null : error.retryAfter;
    }
    const schedule = error.isConcurrencyLimit ? this.concurrencyDelays : this.rateLimitDelays;
    const delay = schedule[attempt - 1];
    return delay === undefined ? null : delay;
  }

  sleep(seconds: number): Promise<void> {
    return this.#sleeper(seconds);
  }
}
