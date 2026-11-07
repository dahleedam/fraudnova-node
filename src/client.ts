import { InvalidArgumentError, UnexpectedResponseError, maskApiKey } from "./errors.js";
import {
  BatchItem,
  BatchResult,
  EmailResult,
  IpResult,
  PhoneResult,
  coerceInt,
  type CheckKind,
} from "./results.js";
import type { RetryPolicy } from "./retry.js";
import { Transport, type FetchLike } from "./transport.js";

/** The production API base URL. */
export const DEFAULT_BASE_URL = "https://fraudnova.com/api/v1";

/** The most subjects the API accepts in one batch request; larger arrays are chunked. */
export const BATCH_MAX = 100;

const DEFAULT_TIMEOUT = 30_000;

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

export interface FraudNovaOptions {
  /** API base URL; defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Per-request timeout in milliseconds; defaults to 30 000. */
  timeout?: number;
  /** Opt-in retry policy for 429 responses. */
  retry?: RetryPolicy;
  /** A fetch-compatible function; defaults to the global `fetch`. */
  fetch?: FetchLike;
}

export interface IpCheckOptions {
  strictness?: 0 | 1 | 2 | 3;
  mobile?: boolean;
  userAgent?: string;
  userLanguage?: string;
}

export interface PhoneCheckOptions {
  country?: string;
}

type Envelope = Record<string, unknown>;

function subject(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InvalidArgumentError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function strictness(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 3) {
    throw new InvalidArgumentError("strictness must be an integer from 0 to 3");
  }
  return value;
}

function country(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value.trim().toUpperCase();
  return cleaned !== "" ? cleaned : undefined;
}

function data(envelope: Envelope): Record<string, unknown> {
  const value = envelope.data;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new UnexpectedResponseError(200, "Missing data", envelope);
  }
  return value as Record<string, unknown>;
}

/** Build the IP options shared by the single and batch calls, keeping only defined values. */
function ipOptions(options: IpCheckOptions): Record<string, number | boolean | string> {
  const out: Record<string, number | boolean | string> = {};
  const level = strictness(options.strictness);
  if (level !== undefined) out.strictness = level;
  if (options.mobile === true || options.mobile === false) out.mobile = options.mobile;
  if (options.userAgent !== undefined) out.user_agent = options.userAgent;
  if (options.userLanguage !== undefined) out.user_language = options.userLanguage;
  return out;
}

/** The FraudNova API client. */
export class FraudNova {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #transport: Transport;

  constructor(apiKey: string, options: FraudNovaOptions = {}) {
    if (typeof apiKey !== "string" || apiKey.trim() === "") {
      throw new InvalidArgumentError("apiKey must be a non-empty string");
    }
    const baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    if (typeof baseUrl !== "string" || !/^https?:\/\//i.test(baseUrl)) {
      throw new InvalidArgumentError("baseUrl must start with http:// or https://");
    }
    const timeout = options.timeout ?? DEFAULT_TIMEOUT;
    if (
      typeof timeout !== "number" ||
      !Number.isFinite(timeout) ||
      timeout <= 0 ||
      timeout > 2_147_483_647
    ) {
      throw new InvalidArgumentError(
        "timeout must be a positive number of milliseconds (at most 2147483647)",
      );
    }
    this.#apiKey = apiKey.trim();
    this.#transport = new Transport({
      apiKey: this.#apiKey,
      baseUrl,
      timeout,
      retry: options.retry ?? null,
      fetch: options.fetch ?? null,
    });
    this.baseUrl = this.#transport.baseUrl;
  }

  /** Score one IP address. */
  async checkIp(ip: string, options: IpCheckOptions = {}): Promise<IpResult> {
    const params = { ip: subject(ip, "ip"), ...ipOptions(options) };
    const envelope = await this.#transport.get("/check", params);
    return IpResult.fromData(data(envelope), coerceInt(envelope.credits_remaining));
  }

  /** Score one email address. */
  async checkEmail(email: string): Promise<EmailResult> {
    const params = { email: subject(email, "email") };
    const envelope = await this.#transport.get("/check/email", params);
    return EmailResult.fromData(data(envelope), coerceInt(envelope.credits_remaining));
  }

  /** Score one phone number. */
  async checkPhone(phone: string, options: PhoneCheckOptions = {}): Promise<PhoneResult> {
    const params = { phone: subject(phone, "phone"), country: country(options.country) };
    const envelope = await this.#transport.get("/check/phone", params);
    return PhoneResult.fromData(data(envelope), coerceInt(envelope.credits_remaining));
  }

  /** Score many IP addresses, chunked by {@link BATCH_MAX}. */
  async checkIps(
    ips: ReadonlyArray<string | null>,
    options: IpCheckOptions = {},
  ): Promise<BatchResult> {
    return this.#batch("/check/batch", "ips", "ip", ips, ipOptions(options));
  }

  /** Score many email addresses, chunked by {@link BATCH_MAX}. */
  async checkEmails(emails: ReadonlyArray<string | null>): Promise<BatchResult> {
    return this.#batch("/check/email/batch", "emails", "email", emails, {});
  }

  /** Score many phone numbers, chunked by {@link BATCH_MAX}. */
  async checkPhones(
    phones: ReadonlyArray<string | null>,
    options: PhoneCheckOptions = {},
  ): Promise<BatchResult> {
    const code = country(options.country);
    const extra: Record<string, string> = code !== undefined ? { country: code } : {};
    return this.#batch("/check/phone/batch", "phones", "phone", phones, extra);
  }

  /** The account's remaining credits. */
  async balance(): Promise<number> {
    const envelope = await this.#transport.get("/balance");
    const credits = coerceInt(envelope.credits_remaining);
    if (credits === null) {
      throw new UnexpectedResponseError(200, "Missing credits_remaining", envelope);
    }
    return credits;
  }

  /** The caller's public IP address as the API sees it (free, unauthenticated). */
  async myIp(): Promise<string> {
    const envelope = await this.#transport.get("/my-ip", null, false);
    const ip = envelope.ip;
    if (typeof ip !== "string" || ip === "") {
      throw new UnexpectedResponseError(200, "Missing ip", envelope);
    }
    return ip;
  }

  async #batch(
    path: string,
    field: string,
    kind: CheckKind,
    subjects: ReadonlyArray<string | null>,
    extra: Record<string, unknown>,
  ): Promise<BatchResult> {
    if (!Array.isArray(subjects)) {
      throw new InvalidArgumentError(`${field} must be an array of values`);
    }
    if (subjects.length === 0) {
      throw new InvalidArgumentError(`${field} must not be empty`);
    }
    const cleaned: Array<string | null> = subjects.map((item: unknown, index) => {
      if (item !== null && typeof item !== "string") {
        throw new InvalidArgumentError(`${field}[${index}] must be a string or null`);
      }
      return item === null ? null : item.trim();
    });

    const items: BatchItem[] = [];
    let credits = 0;
    for (let start = 0; start < cleaned.length; start += BATCH_MAX) {
      const chunk = cleaned.slice(start, start + BATCH_MAX);
      const envelope = await this.#transport.post(path, { [field]: chunk, ...extra });
      if (!Array.isArray(envelope.results)) {
        throw new UnexpectedResponseError(200, "Missing results", envelope);
      }
      const part = BatchResult.fromEnvelope(envelope, kind);
      items.push(...part.items);
      credits = part.creditsRemaining;
      const rest = cleaned.slice(start + BATCH_MAX);
      if (rest.length > 0 && coerceInt(envelope.credits_remaining) === 0) {
        // The API answers 402 to a request sent with a zero balance, which would discard
        // the results above; mark the unsent items the way the API does.
        for (const item of rest) {
          items.push(new BatchItem(item ?? "", false, null, "insufficient_credits"));
        }
        break;
      }
    }
    return new BatchResult(items, credits);
  }

  toString(): string {
    return `FraudNova { apiKey: "${maskApiKey(this.#apiKey)}", baseUrl: "${this.baseUrl}" }`;
  }

  [inspectSymbol](): string {
    return this.toString();
  }
}
