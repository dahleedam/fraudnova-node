import { afterEach, describe, expect, test, vi } from "vitest";
import {
  InsufficientCreditsError,
  InvalidArgumentError,
  RateLimitError,
  TransportError,
  UnexpectedResponseError,
  UpstreamError,
} from "../src/errors.js";
import { RetryPolicy } from "../src/retry.js";
import { Transport, type FetchLike } from "../src/transport.js";
import { jsonResponse, makeFetch } from "./helpers.js";
import { VERSION } from "../src/version.js";

const KEY = "fn_test_key_1234567890";
const OK = { success: true, fraud_score: 10 };
const CONCURRENCY = "Too many concurrent requests for this account. Please retry.";

function transport(
  fetch: FetchLike,
  overrides: { retry?: RetryPolicy | null; timeout?: number; apiKey?: string } = {},
): Transport {
  return new Transport({
    apiKey: overrides.apiKey ?? KEY,
    baseUrl: "https://api.test/v1/",
    timeout: overrides.timeout ?? 30_000,
    retry: overrides.retry ?? null,
    fetch,
  });
}

function recorder(maxAttempts = 3): { policy: RetryPolicy; sleeps: number[] } {
  const sleeps: number[] = [];
  const policy = new RetryPolicy({
    maxAttempts,
    sleep: (seconds) => {
      sleeps.push(seconds);
      return Promise.resolve();
    },
  });
  return { policy, sleeps };
}

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

afterEach(() => {
  vi.useRealTimers();
});

describe("Transport", () => {
  test("get builds the URL, query and headers", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, OK));
    const t = transport(fetch);
    expect(t.baseUrl).toBe("https://api.test/v1");

    const result = await t.get("/check", { ip: "8.8.8.8", strictness: 2, mobile: "true" });

    expect(result).toEqual(OK);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.test/v1/check?ip=8.8.8.8&strictness=2&mobile=true");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.body).toBeUndefined();
    const headers = headersOf(calls[0].init);
    expect(headers.Accept).toBe("application/json");
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(headers["User-Agent"]).toMatch(
      new RegExp(`^fraudnova-node/${VERSION.replace(/\./g, "\\.")} node/\\d+\\.\\d+\\.\\d+$`),
    );
    expect(headers["Content-Type"]).toBeUndefined();
  });

  test("a query value is URL-encoded", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, OK));
    await transport(fetch).get("/check", { ip: "1.1.1.1", user_agent: "Mozilla/5.0 (X11; Linux)" });
    expect(calls[0].url).toContain("user_agent=Mozilla%2F5.0+%28X11%3B+Linux%29");
  });

  test("a get without params has no query string", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, OK));
    await transport(fetch).get("/balance");
    expect(calls[0].url).toBe("https://api.test/v1/balance");
  });

  test("post sends a JSON body and content type", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, OK));
    const input = { ips: ["8.8.8.8", "1.1.1.1"], strictness: 1 };
    await transport(fetch).post("/check/batch", input);
    expect(calls[0].url).toBe("https://api.test/v1/check/batch");
    expect(calls[0].init.method).toBe("POST");
    const headers = headersOf(calls[0].init);
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[0].init.body as string)).toEqual(input);
  });

  test("an unauthenticated get sends no Authorization header", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, { success: true, ip: "8.8.8.8" }));
    await transport(fetch).get("/my-ip", null, false);
    expect(headersOf(calls[0].init).Authorization).toBeUndefined();
    expect(headersOf(calls[0].init).Accept).toBe("application/json");
  });

  test("the api key must be printable ascii without whitespace", () => {
    const { fetch } = makeFetch();
    for (const apiKey of ["fn_ bad", "fn_é", ""]) {
      expect(() => transport(fetch, { apiKey })).toThrow(InvalidArgumentError);
    }
    expect(() => transport(fetch, { apiKey: "fn_ bad" })).toThrow(
      "apiKey must contain only printable ASCII characters, without whitespace.",
    );
  });

  test("a 2xx non-envelope body is an UnexpectedResponseError", async () => {
    const cases: Array<[Response, number, Record<string, unknown>]> = [
      [jsonResponse(200, { success: false }), 200, { success: false }],
      [jsonResponse(200, []), 200, {}],
      [jsonResponse(200, "text"), 200, {}],
      [new Response("not json", { status: 200 }), 200, {}],
      [new Response(null, { status: 204 }), 204, {}],
    ];
    for (const [response, status, body] of cases) {
      const { fetch } = makeFetch(response);
      const error: unknown = await transport(fetch)
        .get("/check")
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnexpectedResponseError);
      expect(error).toMatchObject({
        statusCode: status,
        apiMessage: "Unexpected response body",
        body,
      });
    }
  });

  test("an error status maps through ApiError.fromResponse", async () => {
    const { fetch } = makeFetch(
      jsonResponse(402, { success: false, message: "Insufficient credits." }),
      jsonResponse(429, { success: false, message: "Slow down." }, { "Retry-After": "3" }),
    );
    const t = transport(fetch);
    await expect(t.get("/check")).rejects.toBeInstanceOf(InsufficientCreditsError);
    const error: unknown = await t.get("/check").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3);
  });

  test("a fetch rejection is a TransportError with the key masked", async () => {
    const original = new Error(`ENOTFOUND ${KEY}`);
    const { fetch } = makeFetch(original);
    const error: unknown = await transport(fetch)
      .get("/check")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    const message = (error as TransportError).message;
    expect(message.startsWith("FraudNova request failed: ")).toBe(true);
    expect(message).toContain("fn_…7890");
    expect(message).not.toContain(KEY);
    expect((error as TransportError).cause).toBe(original);
  });

  test("a slow fetch is aborted after the timeout", async () => {
    vi.useFakeTimers();
    const { fetch } = makeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason as Error));
        }),
    );
    const assertion = expect(transport(fetch, { timeout: 50 }).get("/check")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TransportError &&
        error.message.startsWith("FraudNova request timed out after 50 ms") &&
        error.cause !== undefined,
    );
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  test("a body read failure is a TransportError", async () => {
    const original = new Error(`boom ${KEY}`);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(original);
      },
    });
    const { fetch } = makeFetch(new Response(body, { status: 200 }));
    const error: unknown = await transport(fetch)
      .get("/check")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TransportError);
    const message = (error as TransportError).message;
    expect(message.startsWith("FraudNova request failed: ")).toBe(true);
    expect(message).toContain("fn_…7890");
    expect(message).not.toContain(KEY);
    expect((error as TransportError).cause).toBe(original);
  });

  test("a stalled body is aborted after the timeout", async () => {
    vi.useFakeTimers();
    const { fetch } = makeFetch((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          init.signal?.addEventListener("abort", () => c.error(init.signal?.reason));
        },
      });
      return new Response(body, { status: 200 });
    });
    const assertion = expect(transport(fetch, { timeout: 50 }).get("/check")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TransportError &&
        error.message.startsWith("FraudNova request timed out after 50 ms") &&
        error.cause !== undefined,
    );
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  test("the timeout timer is cleared after a response", async () => {
    vi.useFakeTimers();
    const { fetch } = makeFetch(jsonResponse(200, OK));
    await transport(fetch).get("/check");
    expect(vi.getTimerCount()).toBe(0);
  });

  test("retries a 429 per the policy and then succeeds", async () => {
    const { policy, sleeps } = recorder(3);
    const { fetch, calls } = makeFetch(
      jsonResponse(
        429,
        { success: false, message: "Rate limit exceeded." },
        { "Retry-After": "2" },
      ),
      jsonResponse(429, { success: false, message: CONCURRENCY }),
      jsonResponse(200, OK),
    );
    const result = await transport(fetch, { retry: policy }).get("/check");
    expect(result).toEqual(OK);
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([2, 2]);
  });

  test("gives up after maxAttempts", async () => {
    const { policy, sleeps } = recorder(3);
    const limited = () => jsonResponse(429, { success: false, message: CONCURRENCY });
    const { fetch, calls } = makeFetch(limited(), limited(), limited());
    await expect(transport(fetch, { retry: policy }).get("/check")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  test("a bounded policy stops even when every 429 sends Retry-After", async () => {
    const { policy, sleeps } = recorder(2);
    const calls: string[] = [];
    const fetch: FetchLike = (url) => {
      calls.push(url);
      return Promise.resolve(
        jsonResponse(429, { success: false, message: CONCURRENCY }, { "Retry-After": "1" }),
      );
    };
    await expect(transport(fetch, { retry: policy }).get("/check")).rejects.toBeInstanceOf(
      RateLimitError,
    );
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([1]);
  });

  test("does not retry without a policy", async () => {
    const { fetch, calls } = makeFetch(
      jsonResponse(429, { success: false, message: CONCURRENCY }),
      jsonResponse(200, OK),
    );
    await expect(transport(fetch).get("/check")).rejects.toBeInstanceOf(RateLimitError);
    expect(calls).toHaveLength(1);
  });

  test("does not retry other statuses", async () => {
    const { policy, sleeps } = recorder(3);
    const { fetch, calls } = makeFetch(
      jsonResponse(503, { success: false, message: "Upstream lookup failed." }),
      jsonResponse(200, OK),
    );
    await expect(transport(fetch, { retry: policy }).get("/check")).rejects.toBeInstanceOf(
      UpstreamError,
    );
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("does not retry a transport error", async () => {
    const { policy, sleeps } = recorder(3);
    const { fetch, calls } = makeFetch(new Error("ECONNRESET"), jsonResponse(200, OK));
    await expect(transport(fetch, { retry: policy }).get("/check")).rejects.toBeInstanceOf(
      TransportError,
    );
    expect(calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  test("no fetch implementation is an InvalidArgumentError", () => {
    vi.stubGlobal("fetch", undefined);
    try {
      expect(
        () =>
          new Transport({
            apiKey: KEY,
            baseUrl: "https://api.test/v1",
            timeout: 1000,
            retry: null,
            fetch: null,
          }),
      ).toThrow("No fetch implementation available; pass one in the fetch option");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
