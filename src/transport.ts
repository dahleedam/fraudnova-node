import {
  ApiError,
  InvalidArgumentError,
  RateLimitError,
  TransportError,
  UnexpectedResponseError,
  maskApiKey,
} from "./errors.js";
import { type RetryPolicy, parseRetryAfter } from "./retry.js";
import { VERSION } from "./version.js";

/** A `fetch`-compatible function. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TransportOptions {
  apiKey: string;
  baseUrl: string;
  timeout: number;
  retry: RetryPolicy | null;
  fetch: FetchLike | null;
}

type QueryParams = Record<string, string | number | boolean | null | undefined>;

function userAgent(): string {
  let agent = `fraudnova-node/${VERSION}`;
  if (typeof process !== "undefined" && typeof process.versions?.node === "string") {
    agent += ` node/${process.versions.node}`;
  }
  return agent;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Internal HTTP layer: builds requests, decodes the envelope, maps errors, retries 429s. */
export class Transport {
  readonly baseUrl: string;
  readonly #apiKey: string;
  readonly #timeout: number;
  readonly #retry: RetryPolicy | null;
  readonly #fetch: FetchLike;
  readonly #userAgent: string;

  constructor(options: TransportOptions) {
    if (!/^[\x21-\x7e]+$/.test(options.apiKey)) {
      throw new InvalidArgumentError(
        "api_key must contain only printable ASCII characters, without whitespace.",
      );
    }
    let fetchImpl: FetchLike | null = options.fetch ?? null;
    if (fetchImpl === null) {
      const globalFetch = (globalThis as { fetch?: typeof globalThis.fetch }).fetch;
      if (typeof globalFetch === "function") {
        fetchImpl = globalFetch.bind(globalThis);
      }
    }
    if (fetchImpl === null) {
      throw new InvalidArgumentError(
        "No fetch implementation available; pass one in the fetch option",
      );
    }
    this.#apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.#timeout = options.timeout;
    this.#retry = options.retry;
    this.#fetch = fetchImpl;
    this.#userAgent = userAgent();
  }

  get(
    path: string,
    params: QueryParams | null = null,
    authenticated = true,
  ): Promise<Record<string, unknown>> {
    const query = new URLSearchParams();
    for (const [name, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null) continue;
      query.append(name, String(value));
    }
    const search = query.toString();
    const url = this.baseUrl + path + (search !== "" ? `?${search}` : "");
    return this.#send("GET", url, authenticated);
  }

  post(path: string, json: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#send("POST", this.baseUrl + path, true, JSON.stringify(json));
  }

  #headers(authenticated: boolean, hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": this.#userAgent,
    };
    if (authenticated) headers.Authorization = `Bearer ${this.#apiKey}`;
    if (hasBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  async #send(
    method: string,
    url: string,
    authenticated: boolean,
    body?: string,
  ): Promise<Record<string, unknown>> {
    let attempt = 1;
    for (;;) {
      const init: RequestInit = {
        method,
        headers: this.#headers(authenticated, body !== undefined),
      };
      if (body !== undefined) init.body = body;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.#timeout);
      let response: Response;
      try {
        response = await this.#fetch(url, { ...init, signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new TransportError(`FraudNova request timed out after ${this.#timeout} ms`, {
            cause: error,
          });
        }
        const original = error instanceof Error ? error.message : String(error);
        const masked = original.split(this.#apiKey).join(maskApiKey(this.#apiKey));
        throw new TransportError(`FraudNova request failed: ${masked}`, { cause: error });
      } finally {
        clearTimeout(timer);
      }

      try {
        return await Transport.#decode(response);
      } catch (error) {
        if (!(error instanceof RateLimitError)) throw error;
        const delay = this.#retry?.delayFor(error, attempt) ?? null;
        if (this.#retry === null || delay === null) throw error;
        await this.#retry.sleep(delay);
        attempt++;
      }
    }
  }

  static async #decode(response: Response): Promise<Record<string, unknown>> {
    const status = response.status;
    const text = await response.text();
    if (status < 200 || status >= 300) {
      throw ApiError.fromResponse(
        status,
        text,
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }
    let decoded: unknown = null;
    try {
      decoded = JSON.parse(text);
    } catch {
      decoded = null;
    }
    if (!isPlainObject(decoded) || decoded.success !== true) {
      throw new UnexpectedResponseError(
        status,
        "Unexpected response body",
        isPlainObject(decoded) ? decoded : {},
      );
    }
    return decoded;
  }
}
