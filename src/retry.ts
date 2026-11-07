import { InvalidArgumentError, type RateLimitError } from "./errors.js";

const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
const SHORT_DAY = "(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)";
const LONG_DAY = "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)";
const TIME = "[0-9]{2}:[0-9]{2}:[0-9]{2}";

// RFC 7231 HTTP-date: IMF-fixdate, then the obsolete RFC 850 and asctime forms.
const IMF_FIXDATE = new RegExp(`^${SHORT_DAY}, [0-9]{2} ${MONTH} [0-9]{4} ${TIME} GMT$`, "i");
const RFC_850 = new RegExp(`^${LONG_DAY}, [0-9]{2}-${MONTH}-[0-9]{2} ${TIME} GMT$`, "i");
const ASCTIME = new RegExp(`^${SHORT_DAY} ${MONTH} (?: [0-9]|[0-9]{2}) ${TIME} [0-9]{4}$`, "i");

/**
 * Parse a Retry-After header into whole seconds.
 *
 * Accepts delta-seconds (digits only) or an RFC 7231 HTTP-date in one of its three
 * forms: IMF-fixdate (`Sun, 06 Nov 1994 08:49:37 GMT`), RFC 850
 * (`Sunday, 06-Nov-94 08:49:37 GMT`) or asctime (`Sun Nov  6 08:49:37 1994`, read as GMT).
 * Anything else, including a date that does not exist, returns null.
 */
export function parseRetryAfter(value: string | null, now: Date = new Date()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (text === "") return null;
  if (/^[0-9]+$/.test(text)) return Number.parseInt(text, 10);
  let when: number;
  if (IMF_FIXDATE.test(text) || RFC_850.test(text)) when = Date.parse(text);
  else if (ASCTIME.test(text)) when = Date.parse(`${text} GMT`);
  else return null;
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
    if (!Number.isInteger(this.maxAttempts) || this.maxAttempts < 1) {
      throw new InvalidArgumentError("maxAttempts must be an integer of at least 1.");
    }
    if (!Number.isFinite(this.maxRetryAfter) || this.maxRetryAfter < 0) {
      throw new InvalidArgumentError("maxRetryAfter must be a finite number that is not negative.");
    }
    for (const [name, delays] of [
      ["concurrencyDelays", this.concurrencyDelays],
      ["rateLimitDelays", this.rateLimitDelays],
    ] as const) {
      if (
        !delays.every((delay) => typeof delay === "number" && Number.isFinite(delay) && delay >= 0)
      ) {
        throw new InvalidArgumentError(
          `${name} must contain only finite numbers that are not negative.`,
        );
      }
    }
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
