import { describe, expect, test } from "vitest";
import {
  AccountSuspendedError,
  ApiError,
  AuthenticationError,
  FraudNovaError,
  InsufficientCreditsError,
  InvalidArgumentError,
  RateLimitError,
  TransportError,
  UnexpectedResponseError,
  UpstreamError,
  ValidationError,
  maskApiKey,
} from "../src/errors.js";

const envelope = JSON.stringify({ success: false, message: "x" });

describe("errors", () => {
  test("every error is a FraudNovaError and an Error with its class name", () => {
    const instances: Array<[FraudNovaError, string]> = [
      [new FraudNovaError("a"), "FraudNovaError"],
      [new InvalidArgumentError("a"), "InvalidArgumentError"],
      [new TransportError("a"), "TransportError"],
      [new ApiError(500, "a"), "ApiError"],
      [new AuthenticationError(401, "a"), "AuthenticationError"],
      [new InsufficientCreditsError(402, "a"), "InsufficientCreditsError"],
      [new AccountSuspendedError(403, "a"), "AccountSuspendedError"],
      [new ValidationError(422, "a"), "ValidationError"],
      [new RateLimitError(429, "a"), "RateLimitError"],
      [new UpstreamError(503, "a"), "UpstreamError"],
      [new UnexpectedResponseError(200, "a"), "UnexpectedResponseError"],
    ];
    for (const [error, name] of instances) {
      expect(error).toBeInstanceOf(FraudNovaError);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe(name);
    }
  });

  test("transport error keeps its cause", () => {
    const cause = new Error("boom");
    expect(new TransportError("x", { cause }).cause).toBe(cause);
  });

  test.each([
    [401, AuthenticationError],
    [402, InsufficientCreditsError],
    [403, AccountSuspendedError],
    [422, ValidationError],
    [429, RateLimitError],
    [502, UpstreamError],
    [503, UpstreamError],
    [504, UpstreamError],
    [500, ApiError],
    [418, ApiError],
  ])("status dispatch %i", (status, cls) => {
    const error = ApiError.fromResponse(status, envelope);
    expect(error.constructor).toBe(cls);
    expect(error.statusCode).toBe(status);
  });

  test("message format", () => {
    const error = ApiError.fromResponse(
      402,
      JSON.stringify({ success: false, message: "Insufficient credits." }),
    );
    expect(error.message).toBe("FraudNova API error (HTTP 402): Insufficient credits.");
  });

  test("an error key is accepted as the message", () => {
    const error = ApiError.fromResponse(500, JSON.stringify({ error: "bad thing" }));
    expect(error.apiMessage).toBe("bad thing");
  });

  test("html 401 is a plain ApiError", () => {
    const html = `  <html>${"x".repeat(300)}</html>  `;
    const error = ApiError.fromResponse(401, html);
    expect(error.constructor).toBe(ApiError);
    expect(error.apiMessage).toBe(html.trim().slice(0, 200));
    expect(error.message.endsWith("non-JSON response")).toBe(true);
  });

  test("html 429 is a RateLimitError", () => {
    const error = ApiError.fromResponse(429, "<html>slow down</html>", 3);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3);
  });

  test("a 503 envelope marks the credit refunded", () => {
    const error = ApiError.fromResponse(503, envelope) as UpstreamError;
    expect(error.creditRefunded).toBe(true);
    expect(error.message.endsWith("The credit for this check was refunded.")).toBe(true);
  });

  test("a 503 html page is not refunded", () => {
    const error = ApiError.fromResponse(503, "<html>down</html>") as UpstreamError;
    expect(error).toBeInstanceOf(UpstreamError);
    expect(error.creditRefunded).toBe(false);
    expect(error.message).not.toContain("refunded");
  });

  test("rate limit carries retryAfter and detects the concurrency cap", () => {
    const concurrent = ApiError.fromResponse(
      429,
      JSON.stringify({
        success: false,
        message: "Too many concurrent requests for this account. Please retry.",
      }),
      7,
    ) as RateLimitError;
    expect(concurrent.retryAfter).toBe(7);
    expect(concurrent.isConcurrencyLimit).toBe(true);
    const plain = ApiError.fromResponse(
      429,
      JSON.stringify({ success: false, message: "Rate limit exceeded. Try again shortly." }),
    ) as RateLimitError;
    expect(plain.isConcurrencyLimit).toBe(false);
    expect(plain.retryAfter).toBeNull();
  });

  test("an empty body gives HTTP <status> as the message", () => {
    const error = ApiError.fromResponse(500, "");
    expect(error.apiMessage).toBe("HTTP 500");
  });

  test("a JSON 401 without success or message is a plain ApiError", () => {
    const error = ApiError.fromResponse(401, JSON.stringify({ detail: "nope" }));
    expect(error).not.toBeInstanceOf(AuthenticationError);
    expect(error.name).toBe("ApiError");
    expect(error.statusCode).toBe(401);
    expect(error.apiMessage).toBe('{"detail":"nope"}');
    expect(error.body).toEqual({ detail: "nope" });
  });

  test("maskApiKey", () => {
    expect(maskApiKey("fn_live_abcdefghijkl")).toBe("fn_…ijkl");
    expect(maskApiKey("fn_short")).toBe("fn_…");
  });
});
