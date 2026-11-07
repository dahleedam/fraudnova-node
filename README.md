# @fraudnova/sdk

[FraudNova](https://fraudnova.com) is a fraud-detection API. It returns a fraud score and risk flags for any IP address, email address or phone number, so your application can decide whether to accept, review or block a signup, lead or order. This is the official Node.js client.

[![CI](https://github.com/dahleedam/fraudnova-node/actions/workflows/ci.yml/badge.svg)](https://github.com/dahleedam/fraudnova-node/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40fraudnova%2Fsdk)](https://www.npmjs.com/package/@fraudnova/sdk)
[![Node versions](https://img.shields.io/node/v/%40fraudnova%2Fsdk)](https://www.npmjs.com/package/@fraudnova/sdk)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

## Requirements

- Node.js 18 or later
- No runtime dependencies: the client uses the built-in `fetch`
- ESM and CommonJS are both supported, and TypeScript types are included

## Installation

```bash
npm install @fraudnova/sdk
```

You need an API key. [Register](https://fraudnova.com/register) to get free trial credits, then create a key at [fraudnova.com/dashboard/api-keys](https://fraudnova.com/dashboard/api-keys). The key starts with `fn_` and is shown once, so copy it right away.

## Quickstart

```js
import { FraudNova } from "@fraudnova/sdk";

const client = new FraudNova("fn_your_api_key");
const result = await client.checkIp("8.8.8.8");
if (result.flagged()) {
  // review or block
}
console.log(result.fraudScore);
```

With CommonJS, load the client with `require`:

```js
const { FraudNova } = require("@fraudnova/sdk");
```

## Checking IP addresses, emails and phone numbers

```js
const client = new FraudNova("fn_your_api_key");

const ip = await client.checkIp("8.8.8.8");
const email = await client.checkEmail("someone@example.com");
const phone = await client.checkPhone("+1 817 679 1808");
const hinted = await client.checkPhone("8176791808", { country: "US" }); // optional two-letter country hint
```

`checkIp()` takes an optional options object. Leave an option out to use the API default.

```js
const result = await client.checkIp(visitorIp, {
  strictness: 1, // 0 = lenient, 3 = strict
  mobile: false, // the request comes from a mobile device
  userAgent: req.headers["user-agent"], // enables the device and browser fields
  userLanguage: req.headers["accept-language"]?.split(",")[0]?.trim() || undefined,
});
```

`userLanguage` takes a short language tag such as `en-US`, not the whole `Accept-Language` header, so the example sends only the first tag.

An empty value, or a `strictness` that is not an integer from 0 to 3, throws `InvalidArgumentError` before any request is sent.

## Batch checks

`checkIps()`, `checkEmails()` and `checkPhones()` score an array of values. The array can be any length: the client splits it into requests of 100 (`BATCH_MAX`) and joins the answers in input order.

```js
const batch = await client.checkIps(ips);

for (const item of batch.successful()) {
  console.log(item.subject, item.result.fraudScore);
}

for (const item of batch.failed()) {
  console.log(item.subject, "failed:", item.error);
}

console.log("Credits left:", batch.creditsRemaining);
```

`checkIps()` takes the same options as `checkIp()`, and `checkPhones()` takes one `country` hint for the whole batch. A `BatchResult` is iterable with `for...of`, has a `length`, and keeps every item in `items`; each `BatchItem` has `subject`, `success`, `result` (an `IpResult`, `EmailResult` or `PhoneResult`, or `null` on failure) and `error`. `hasFailures()` tells you whether any item failed.

Batches are split into requests of 100. When a request reports zero credits remaining, the client stops and marks the remaining items `insufficient_credits` instead of sending a request that would fail. Any other error on a later request (a 429 with no retry policy or with the retries used up, a 503, or a `TransportError`) is thrown, and the results of the earlier requests are discarded even though they were billed. If you need control over each request, slice the array to 100 yourself:

```js
import { BATCH_MAX } from "@fraudnova/sdk";

for (let start = 0; start < ips.length; start += BATCH_MAX) {
  const batch = await client.checkIps(ips.slice(start, start + BATCH_MAX));
  // handle this request's result before sending the next
}
```

Items must be strings or `null`; any other type throws `InvalidArgumentError` before the request is sent. One bad value never fails the batch, so an empty string or `null` comes back as a failed item. A failed item carries one of these error codes:

| `error`                                        | Helper                    | Meaning                                                             |
| ---------------------------------------------- | ------------------------- | ------------------------------------------------------------------- |
| `invalid_ip`, `invalid_email`, `invalid_phone` | `isInvalid()`             | The value is not a valid IP address, email address or phone number. |
| `insufficient_credits`                         | `isInsufficientCredits()` | Your balance ran out partway through the batch.                     |
| `upstream_failed`                              | `isUpstreamFailed()`      | The lookup failed. The item was not charged.                        |

## Results

`checkIp()`, `checkEmail()` and `checkPhone()` resolve to an `IpResult`, `EmailResult` or `PhoneResult`. Each has the API's fields as camelCase properties, for example `fraudScore`, `recentAbuse` and `countryCode`. `fraudScore` is always a number (0 when the API does not return one); every other field can be `null`, because the API does not return every field for every check.

```js
const ip = await client.checkIp("8.8.8.8");
ip.proxy; // boolean | null
ip.vpn; // boolean | null
ip.countryCode; // string | null, for example "US"
ip.isp; // string | null (API field ISP)
ip.asn; // number | null (API field ASN)

const email = await client.checkEmail("someone@example.com");
email.disposable; // boolean | null
email.deliverability; // string | null
email.firstSeen; // DateInfo | null, also domainAge

const phone = await client.checkPhone("+18176791808");
phone.voip; // boolean | null (API field VOIP)
phone.lineType; // string | null
phone.carrier; // string | null
```

The email dates `firstSeen` and `domainAge` are `DateInfo` objects with `human`, `timestamp` and `iso`.

`raw` holds the full API response for that check, with the original field names, including any field the client does not map to a property. `toJSON()` returns the same object, so `JSON.stringify(result)` gives you the API's own fields:

```js
const result = await client.checkIp("8.8.8.8");
result.raw; // { fraud_score: 20, proxy: false, ISP: "Google", ... }
JSON.stringify(result); // '{"fraud_score":20,"proxy":false,"ISP":"Google",...}'
```

`creditsRemaining` holds your balance after the check. It is `null` on results inside a batch; read `BatchResult.creditsRemaining` there instead.

## The `flagged()` helper

`flagged()` returns `true` when the `fraud_score` is at or above a risk threshold (default 75), or when any of a set of fields is `true`. `flagReasons()` lists which of those fired, for example `["fraud_score", "proxy"]`. Both take the same optional options object, `{ riskThreshold, flagOn }`.

| Check         | Fields checked by default |
| ------------- | ------------------------- |
| IP address    | `proxy`, `vpn`, `tor`     |
| Email address | `disposable`              |
| Phone number  | `VOIP`, `risky`           |

Pass your own threshold and fields with the raw API field names (`VOIP`, not `voip`):

```js
const result = await client.checkPhone("+18176791808");
const rules = { riskThreshold: 85, flagOn: ["VOIP", "risky", "recent_abuse"] };

if (result.flagged(rules)) {
  const reasons = result.flagReasons(rules);
  // ...
}
```

The defaults are available as `IpResult.DEFAULT_FLAG_ON`, `EmailResult.DEFAULT_FLAG_ON` and `PhoneResult.DEFAULT_FLAG_ON`.

## Balance and your IP

```js
const credits = await client.balance(); // number, costs no credits
const myAddress = await client.myIp(); // string, the public IP your server calls from; no API key is sent
```

## Errors

Every error the client throws is a `FraudNovaError`, so one `instanceof` check handles them all. Each error class also sets `name`, for example `"RateLimitError"`.

```js
import { FraudNovaError, InsufficientCreditsError } from "@fraudnova/sdk";

try {
  const result = await client.checkIp(visitorIp);
} catch (error) {
  if (error instanceof InsufficientCreditsError) {
    // buy a credit pack in the FraudNova dashboard
  } else if (error instanceof FraudNovaError) {
    // log it and let the request through, or hold it for review
  } else {
    throw error;
  }
}
```

| Error                      | Status                 | When                                                                                                                                                                                                                          |
| -------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthenticationError`      | 401                    | The API key is missing, invalid or revoked.                                                                                                                                                                                   |
| `InsufficientCreditsError` | 402                    | Your balance is too low for the check.                                                                                                                                                                                        |
| `AccountSuspendedError`    | 403                    | The account is suspended.                                                                                                                                                                                                     |
| `ValidationError`          | 422                    | The API rejected the request parameters.                                                                                                                                                                                      |
| `RateLimitError`           | 429                    | Too many requests, or too many checks in flight at once. `retryAfter` (seconds, or `null`) and `isConcurrencyLimit` tell you which.                                                                                           |
| `UpstreamError`            | 502, 503, 504          | The lookup failed. On a 503 the credit is refunded automatically and `creditRefunded` is `true`.                                                                                                                              |
| `UnexpectedResponseError`  | 2xx                    | The response could not be read as a FraudNova response.                                                                                                                                                                       |
| `ApiError`                 | any other error status | Base class of every error with a status. `statusCode`, `apiMessage` and `body` are on all of them. A 401, 402, 403 or 422 whose body is not a FraudNova JSON response (for example a proxy error page) is a plain `ApiError`. |
| `TransportError`           | none                   | The request failed before a response arrived, for example a timeout or DNS error. The original error is `cause`.                                                                                                              |
| `InvalidArgumentError`     | none                   | A value was empty or out of range; no request was sent.                                                                                                                                                                       |

## Retries

The client does not retry by default. To retry HTTP 429 responses, pass a `RetryPolicy`:

```js
import { FraudNova, RetryPolicy } from "@fraudnova/sdk";

const client = new FraudNova("fn_your_api_key", {
  retry: new RetryPolicy({ maxAttempts: 3 }),
});
```

`maxAttempts` counts the first attempt, so `3` means up to two retries. Only 429 is retried; every other error is thrown right away. The wait is the `Retry-After` header when the response has one, otherwise a short schedule for the concurrency limit (`concurrencyDelays`, default `[1, 2, 4]`) and a longer one for the rate limit (`rateLimitDelays`, default `[5, 15, 40]`). All `RetryPolicy` values are in seconds. When the attempts run out, the `RateLimitError` is thrown. A `Retry-After` longer than `maxRetryAfter` (60 seconds by default) is not waited for; the `RateLimitError` is thrown right away. Set `honourRetryAfter: false` to always use the schedules. In your own tests, pass `sleep: async () => {}` so retries do not wait. Batch requests are safe to retry, because a 429 is returned before any item is checked.

Retries can make one call slow. With `new RetryPolicy({ maxAttempts: 3 })` and the default `maxRetryAfter` of 60, one call can sleep for up to about two minutes, plus three timeouts. Inside a web request, use a small `maxRetryAfter` (for example `2`) and a short `timeout`, and keep the full policy for background jobs.

## Bring your own fetch

The client calls the global `fetch` with a 30 second timeout per request. Change the timeout with the `timeout` option, in milliseconds:

```js
const client = new FraudNova("fn_your_api_key", { timeout: 5_000 });
```

Proxies, custom TLS and connection pooling belong to the HTTP layer, so pass your own `fetch` function. For example, to send requests through a proxy with [undici](https://undici.nodejs.org/) (install it yourself with `npm install undici`; it is not a dependency of this package):

```js
import { FraudNova } from "@fraudnova/sdk";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const dispatcher = new ProxyAgent("http://proxy.internal:3128");

const client = new FraudNova("fn_your_api_key", {
  fetch: (url, init) => undiciFetch(url, { ...init, dispatcher }),
  timeout: 10_000,
});
```

The `fetch` option takes any function with the signature `(url: string, init: RequestInit) => Promise<Response>` (the `FetchLike` type). The client still applies its own `timeout` to every call. Use `baseUrl` to point the client somewhere other than `https://fraudnova.com/api/v1` (`DEFAULT_BASE_URL`).

## Testing

Inject a fake `fetch`, so your tests send no real request:

```js
import assert from "node:assert/strict";
import { FraudNova } from "@fraudnova/sdk";

const fakeFetch = async () =>
  new Response(
    JSON.stringify({
      success: true,
      data: { fraud_score: 12, proxy: false },
      credits_remaining: 99,
    }),
    { status: 200 },
  );

const client = new FraudNova("fn_test", { fetch: fakeFetch });
const result = await client.checkIp("8.8.8.8");

assert.equal(result.fraudScore, 12);
assert.equal(result.creditsRemaining, 99);
```

## TypeScript

The package ships its own type definitions for both ESM and CommonJS; no `@types` package is needed. Besides the classes (`FraudNova`, `RetryPolicy`, `IpResult`, `EmailResult`, `PhoneResult`, `BatchResult`, `BatchItem` and every error class), it exports these types:

| Type                 | Describes                                                   |
| -------------------- | ----------------------------------------------------------- |
| `FraudNovaOptions`   | The client options: `baseUrl`, `timeout`, `retry`, `fetch`. |
| `IpCheckOptions`     | `checkIp()` and `checkIps()` options.                       |
| `PhoneCheckOptions`  | `checkPhone()` and `checkPhones()` options (`country`).     |
| `FetchLike`          | The `fetch` function the client accepts.                    |
| `RetryPolicyOptions` | The `RetryPolicy` constructor options.                      |
| `FlagOptions`        | The `flagged()` and `flagReasons()` options.                |
| `DateInfo`           | The `firstSeen` and `domainAge` email dates.                |
| `Result`             | `IpResult \| EmailResult \| PhoneResult`.                   |
| `CheckKind`          | `"ip" \| "email" \| "phone"`.                               |

```ts
import { FraudNova, type IpCheckOptions, type IpResult } from "@fraudnova/sdk";

const client = new FraudNova(process.env.FRAUDNOVA_API_KEY ?? "");
const options: IpCheckOptions = { strictness: 1 };
const result: IpResult = await client.checkIp("8.8.8.8", options);
```

The package also exports `VERSION` (the SDK version, sent in the `User-Agent` header), `BATCH_MAX`, `DEFAULT_BASE_URL`, and three small helpers: `maskApiKey()` (a shortened key such as `fn_…abcd` that is safe to log), `parseRetryAfter()` and `parseDateInfo()`.

## Credits and limits

One check costs one credit, whichever type it is. Failed checks are refunded. You get free trial credits when you verify your email address, and you buy more as credit packs, with no subscription. A batch costs one credit per successful item.

The API limits requests per minute for each key and checks in flight for each account. The current limits are in the [API documentation](https://fraudnova.com/docs).

## Resources

- [FraudNova API documentation](https://fraudnova.com/docs)
- [Examples repository](https://github.com/dahleedam/fraudnova-examples)
- [Status](https://fraudnova.com/status)
- [Changelog](https://fraudnova.com/changelog)
- Support: [support@fraudnova.com](mailto:support@fraudnova.com)

## Licence

Released under the MIT license. See [LICENSE](LICENSE).
