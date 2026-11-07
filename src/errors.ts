/** Return a safe, shortened form of an API key for display. */
export function maskApiKey(apiKey: string): string {
  return apiKey.length > 12 ? `fn_…${apiKey.slice(-4)}` : "fn_…";
}

/** Base class for every error thrown by this SDK. */
export class FraudNovaError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FraudNovaError";
  }
}

/** A client-side input problem; no request was sent. */
export class InvalidArgumentError extends FraudNovaError {
  constructor(message?: string) {
    super(message);
    this.name = "InvalidArgumentError";
  }
}

/** The HTTP request itself failed (timeout, DNS, TLS). */
export class TransportError extends FraudNovaError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransportError";
  }
}

/** The API answered with an error status. */
export class ApiError extends FraudNovaError {
  readonly statusCode: number;
  readonly apiMessage: string;
  readonly body: Record<string, unknown>;

  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(message ?? `FraudNova API error (HTTP ${statusCode}): ${apiMessage}`);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.apiMessage = apiMessage;
    this.body = body;
  }

  static fromResponse(
    statusCode: number,
    text: string,
    retryAfter: number | null = null,
  ): ApiError {
    let decoded: unknown = null;
    try {
      decoded = JSON.parse(text);
    } catch {
      decoded = null;
    }
    const isJson = typeof decoded === "object" && decoded !== null && !Array.isArray(decoded);
    const body: Record<string, unknown> = isJson ? (decoded as Record<string, unknown>) : {};
    const envelope = isJson && ("success" in body || "message" in body);

    let apiMessage = "";
    for (const key of ["message", "error"]) {
      const value = body[key];
      if (typeof value === "string" && value !== "") {
        apiMessage = value;
        break;
      }
    }
    if (apiMessage === "") {
      const stripped = text.trim();
      apiMessage = stripped !== "" ? stripped.slice(0, 200) : `HTTP ${statusCode}`;
    }

    const full = isJson ? undefined : `FraudNova API error (HTTP ${statusCode}): non-JSON response`;

    if (envelope && statusCode === 401)
      return new AuthenticationError(statusCode, apiMessage, body, full);
    if (envelope && statusCode === 402) {
      return new InsufficientCreditsError(statusCode, apiMessage, body, full);
    }
    if (envelope && statusCode === 403)
      return new AccountSuspendedError(statusCode, apiMessage, body, full);
    if (envelope && statusCode === 422)
      return new ValidationError(statusCode, apiMessage, body, full);
    if (statusCode === 429) {
      return new RateLimitError(statusCode, apiMessage, body, retryAfter, full);
    }
    if (statusCode === 502 || statusCode === 503 || statusCode === 504) {
      return new UpstreamError(statusCode, apiMessage, body, statusCode === 503 && envelope, full);
    }
    return new ApiError(statusCode, apiMessage, body, full);
  }
}

/** 401: missing or invalid API key. */
export class AuthenticationError extends ApiError {
  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "AuthenticationError";
  }
}

/** 402: the account has no credits left. */
export class InsufficientCreditsError extends ApiError {
  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "InsufficientCreditsError";
  }
}

/** 403: the account is suspended. */
export class AccountSuspendedError extends ApiError {
  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "AccountSuspendedError";
  }
}

/** 422: the request failed validation. */
export class ValidationError extends ApiError {
  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "ValidationError";
  }
}

/** 429: rate or concurrency limit hit. */
export class RateLimitError extends ApiError {
  readonly retryAfter: number | null;

  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    retryAfter: number | null = null,
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "RateLimitError";
    this.retryAfter = retryAfter;
  }

  get isConcurrencyLimit(): boolean {
    return this.apiMessage.includes("Too many concurrent requests");
  }
}

/** 502/503/504: the lookup could not be completed. */
export class UpstreamError extends ApiError {
  readonly creditRefunded: boolean;

  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    creditRefunded = false,
    message?: string,
  ) {
    let text = message ?? `FraudNova API error (HTTP ${statusCode}): ${apiMessage}`;
    if (creditRefunded) text += " The credit for this check was refunded.";
    super(statusCode, apiMessage, body, text);
    this.name = "UpstreamError";
    this.creditRefunded = creditRefunded;
  }
}

/** A 2xx response whose body is not the success envelope. */
export class UnexpectedResponseError extends ApiError {
  constructor(
    statusCode: number,
    apiMessage: string,
    body: Record<string, unknown> = {},
    message?: string,
  ) {
    super(statusCode, apiMessage, body, message);
    this.name = "UnexpectedResponseError";
  }
}
