# FraudNova Node.js SDK — design (2026-11-07)

## Intent

Ship the official Node.js / TypeScript client for the FraudNova API as the npm package
`@fraudnova/sdk`, so a JavaScript developer can score an IP, email address or phone number in four
lines without writing HTTP code or re-implementing the error envelope. It mirrors the Python SDK
(`fraudnova` on PyPI, 2026-11-07) and the PHP SDK (`fraudnova/fraudnova-php`, 2026-11-06) in public
shape and naming wherever TypeScript idioms allow, so the three READMEs and the `/docs` tabs read as
one family.

Sibling projects to stay consistent with: the Python SDK (`/Users/dahleedam/Herd/fraudnova-python`,
spec `docs/superpowers/specs/2026-11-06-python-sdk-design.md` — the reference for API facts and
behaviour), the PHP SDK (`/Users/dahleedam/Herd/fraudnova-php`), the n8n community node
(`/Users/dahleedam/Herd/n8n-nodes-fraudnova`, whose release workflow is the npm Trusted Publishing
reference) and the examples repository (`dahleedam/fraudnova-examples`, `examples/node/*.mjs`).

## Goals

- `npm install @fraudnova/sdk` then `(await new FraudNova("fn_…").checkIp("8.8.8.8")).fraudScore`.
- Every public endpoint wrapped: `GET /check`, `/check/email`, `/check/phone`, the three batch
  endpoints, `GET /balance`, public `GET /my-ip`.
- Typed result classes with `flagged()` / `flagReasons()` mirroring the Python and PHP SDKs.
- Every API error status mapped to a typed error class; opt-in retry on 429 honouring `Retry-After`.
- Batch methods accept any number of items and chunk by 100, with the Python SDK's stop-at-zero rule.
- Node 18+, global `fetch`, **zero runtime dependencies**. TypeScript source, ESM + CJS builds with
  `.d.ts`, vitest with a mocked `fetch` (no live calls), eslint + prettier clean, CI on Node 18/20/22,
  npm Trusted Publishing with provenance on a `v*` tag.
- Repo ready for the owner to push to `github.com/dahleedam/fraudnova-node` and tag `v1.0.0`.

## Non-goals (v1)

- No browser bundle or Deno/Bun-specific entry (it may work there; not tested, not promised).
- No webhook signature helper (the examples repo has one).
- No caching, logging, or retries on anything but 429.
- No framework integrations (Express/Next middleware).

## Anti-goals

- Nothing in the package, README, JSDoc, tests, this document, the changelog or commit messages may
  name the upstream scoring provider (full name or four-letter abbreviation) or describe pool
  internals, upstream credentials or quotas. A test greps the repository for the forbidden strings,
  assembled from fragments inside the test file.
- The API key must never appear in an error message, `toString()`, `inspect` output or log line.
- No runtime dependencies at all (`dependencies` is absent from `package.json`).

## Constraints

- Node ≥ 18 (`engines.node: ">=18"`), so global `fetch`, `Request`, `Response`, `Headers`,
  `AbortController` exist. No `node:` imports in the runtime code except an optional `process`
  read guarded by `typeof process !== "undefined"`.
- Language: TypeScript 5.9 (`strict: true`, `exactOptionalPropertyTypes` off, target `ES2022`,
  module `ESNext`, `moduleResolution: "bundler"`), built with **tsup 8** to `dist/index.js` (ESM),
  `dist/index.cjs` (CJS), `dist/index.d.ts` and `dist/index.d.cts`. `package.json` has
  `"type": "module"`, `exports` with `import`/`require`/`types` conditions, `main`/`module`/`types`
  fallbacks, `files: ["dist"]`, `sideEffects: false`, `publishConfig.access: "public"`.
- Dev tools: vitest 3, eslint 9 (flat config) + typescript-eslint 8 + `@eslint/js`, prettier 3,
  `@types/node` 22, tsup 8, typescript 5.9. Scripts: `build`, `test`, `test:watch`, `lint`
  (eslint + prettier check), `format`, `typecheck` (`tsc --noEmit`), `prepublishOnly`
  (`npm run lint && npm run typecheck && npm test && npm run build`).
- Package name `@fraudnova/sdk` (fallback: `fraudnova`, also free on npm; the rename is three
  edits documented in `docs/RELEASING.md`). Version `1.0.0`, exported as `VERSION`.
- Licence MIT, copyright "FraudNova" (same text as the Python SDK).
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. The owner pushes
  and publishes; nothing here pushes or publishes.

## The API being wrapped

Identical to the Python spec's section; the facts that matter here:

- Base URL `https://fraudnova.com/api/v1`, header `Authorization: Bearer fn_…`, JSON everywhere.
- Single checks: `GET /check?ip=…` (+ `strictness` 0–3, `mobile` true/false, `user_agent` ≤512,
  `user_language` ≤32), `GET /check/email?email=…`, `GET /check/phone?phone=…&country=XX`.
  Success body `{success: true, data: {…}, credits_remaining: int}`.
- Batches: `POST /check/batch` `{ips: […≤100], strictness?, mobile?, user_agent?, user_language?}`,
  `POST /check/email/batch` `{emails: […]}`, `POST /check/phone/batch` `{phones: […], country?}`.
  Success body `{success: true, results: [{ip|email|phone, success, data?, error?}], credits_remaining}`.
  Per-item `error`: `invalid_ip` / `invalid_email` / `invalid_phone`, `insufficient_credits`,
  `upstream_failed`. Always HTTP 200 on a valid envelope; 402 only when the balance was zero at the
  start; 422 on a bad envelope.
- `GET /balance` → `{success: true, credits_remaining}`; `GET /my-ip` (no auth) → `{success: true, ip}`.
- Error envelope `{success: false, message: "…"}`: 401 token missing/invalid, 402 "Insufficient
  credits.", 403 "Account suspended.", 422 first validation message, 429 "Rate limit exceeded. Try
  again shortly." (per-key) or "Too many concurrent requests for this account. Please retry."
  (per-account cap), 503 "Upstream lookup failed." (credit refunded). Both 429s send `Retry-After`
  (the concurrency cap sends `Retry-After: 1`).
- Cloudflare fronts the API: a non-JSON HTML body with 5xx (or a challenge page with 4xx) is possible.
- Email results' `first_seen` and `domain_age` are `{human, timestamp, iso}` objects (older rows
  may be bare strings).
- Result fields per type: exactly the Python spec's lists (IP `fraud_score`, `proxy`, `vpn`, `tor`,
  `active_vpn`, `active_tor`, `recent_abuse`, `bot_status`, `country_code`, `region`, `city`, `ISP`,
  `organization`, `ASN`, `operating_system`, `browser`, `device_brand`, `device_model`; email
  `valid`, `disposable`, `catch_all`, `generic`, `common`, `dns_valid`, `honeypot`,
  `frequent_complainer`, `suspect`, `recent_abuse`, `leaked`, `risky_tld`, `spf_record`,
  `dmarc_record`, `fraud_score`, `smtp_score`, `overall_score`, `deliverability`, `spam_trap_score`,
  `result_type`, `sanitized_email`, `first_seen`, `domain_age`; phone `valid`, `recent_abuse`, `VOIP`,
  `prepaid`, `risky`, `active`, `do_not_call`, `leaked`, `spammer`, `fraud_score`, `dialing_code`,
  `carrier`, `line_type`, `country`, `region`, `city`, `timezone`, `zip_code`, `active_status`,
  `formatted`, `local_format`). Any field may be absent; parsing never throws on a mistyped field
  (lenient coercion, raw value kept in `raw`).

## Package shape

```
fraudnova-node/
  package.json, tsconfig.json, tsup.config.ts, vitest.config.ts, eslint.config.js, .prettierrc.json
  .gitignore, .editorconfig, LICENSE, README.md, CHANGELOG.md
  src/
    index.ts        public re-exports (everything below that is public)
    version.ts      export const VERSION = "1.0.0"
    client.ts       FraudNova class, BATCH_MAX, DEFAULT_BASE_URL, option types
    errors.ts       the error hierarchy + maskApiKey()
    retry.ts        RetryPolicy, parseRetryAfter()
    results.ts      DateInfo, IpResult, EmailResult, PhoneResult, BatchItem, BatchResult, coercion
    transport.ts    Transport (internal): builds/sends requests, decodes, maps errors, applies RetryPolicy
  tests/            vitest; helpers.ts with a queued mock fetch factory
  .github/workflows/ci.yml, release.yml
  docs/RELEASING.md, docs/superpowers/specs|plans/…
```

## Public API

```ts
import { FraudNova, RetryPolicy } from "@fraudnova/sdk";

const client = new FraudNova("fn_your_key"); // global fetch, 30 s timeout
const client = new FraudNova("fn_your_key", {
  baseUrl: "https://fraudnova.com/api/v1",
  timeout: 10_000, // milliseconds
  retry: new RetryPolicy({ maxAttempts: 3 }),
  fetch: myFetch, // any fetch-compatible function (undici, node-fetch, a test double)
});

const ip = await client.checkIp("8.8.8.8"); // IpResult
const ip = await client.checkIp("8.8.8.8", { strictness: 3, mobile: true, userAgent: ua, userLanguage: "en-US" });
const email = await client.checkEmail("user@example.com"); // EmailResult
const phone = await client.checkPhone("18176791808", { country: "US" }); // PhoneResult

const batch = await client.checkIps(["8.8.8.8", "1.1.1.1"], { strictness: 2 }); // BatchResult, chunked by 100
const batch = await client.checkEmails([...]);
const batch = await client.checkPhones([...], { country: "US" });

const credits = await client.balance(); // number
const myIp = await client.myIp(); // string
```

Constants: `BATCH_MAX = 100`, `DEFAULT_BASE_URL`, `VERSION`.

Option types (exported): `FraudNovaOptions { baseUrl?: string; timeout?: number; retry?: RetryPolicy;
fetch?: typeof fetch }`, `IpCheckOptions { strictness?: 0 | 1 | 2 | 3; mobile?: boolean; userAgent?:
string; userLanguage?: string }`, `PhoneCheckOptions { country?: string }`.

Behaviour:

- `apiKey` is trimmed; empty or non-string throws `InvalidArgumentError`; it must contain only
  printable ASCII without whitespace (otherwise `InvalidArgumentError`). `baseUrl` must start with
  `http://` or `https://` (case-insensitive) else `InvalidArgumentError`; a trailing slash is stripped.
  `timeout` must be a finite number > 0 (milliseconds) else `InvalidArgumentError`.
- Subjects are trimmed; an empty or non-string subject throws `InvalidArgumentError` before any
  request. The thrown error is a rejected promise (methods are `async`), never a synchronous throw.
- `strictness` outside `0..3` (or non-integer) throws `InvalidArgumentError`; only defined options
  are sent. In the GET query `mobile` is sent as the literal `true`/`false`; in a batch JSON body it
  is a JSON boolean. Query keys use the API's snake_case (`user_agent`, `user_language`).
- `country` is trimmed and upper-cased; empty/undefined is not sent.
- **Batch:** `checkIps`/`checkEmails`/`checkPhones` take an array of `string | null`. A non-array
  or empty array throws `InvalidArgumentError`; any item that is neither string nor `null` throws
  `InvalidArgumentError` naming its index. Items are trimmed (`null` and `""` are sent as-is; the
  API answers them per item). The array is split into chunks of `BATCH_MAX` and one POST is sent per
  chunk, in order; `BatchResult.items` is the concatenation in input order and `creditsRemaining` is
  the last response's value. When a response reports `credits_remaining === 0` and items remain, no
  further POST is sent: each remaining item becomes a failed `BatchItem` with
  `error: "insufficient_credits"` (subject trimmed, `""` for `null`). Any other error on a later
  chunk rejects after earlier chunks were already billed — the README says so and tells users who
  need per-chunk control to slice the array themselves.
- `myIp()` sends no `Authorization` header. Every other call sends it.
- Headers on every request: `Accept: application/json`, `User-Agent: fraudnova-node/<VERSION>
  node/<process.versions.node>` (the `node/…` suffix only when `process.versions.node` is readable);
  `Content-Type: application/json` on POST.
- `timeout` is enforced with an `AbortController` per request; an abort surfaces as `TransportError`
  whose message starts with `FraudNova request timed out after <n> ms`. Any other `fetch` rejection
  is a `TransportError` (`cause` = the original error) with the API key masked out of the message.
- `String(client)` / `util.inspect(client)` never show the key: the class stores it in a private
  field (`#apiKey`) and defines `[Symbol.for("nodejs.util.inspect.custom")]()` returning
  `FraudNova { apiKey: "fn_…abcd", baseUrl: "…" }`. `maskApiKey(key)` is `"fn_…" + last four
  characters` when the key is longer than 12 characters, else `"fn_…"`.

### Results

`IpResult`, `EmailResult`, `PhoneResult` are classes with `readonly` camelCase properties, built via
`static fromData(data: Record<string, unknown>, creditsRemaining: number | null = null)`. Each exposes:

- camelCase properties for every documented API field (`fraudScore: number` — `0` when missing or
  mistyped; everything else `T | null`). API names map `ISP` → `isp`, `ASN` → `asn`, `VOIP` → `voip`,
  snake_case → camelCase (`country_code` → `countryCode`, `active_vpn` → `activeVpn`,
  `recent_abuse` → `recentAbuse`, `bot_status` → `botStatus`, `operating_system` →
  `operatingSystem`, `device_brand` → `deviceBrand`, `device_model` → `deviceModel`, `catch_all` →
  `catchAll`, `dns_valid` → `dnsValid`, `frequent_complainer` → `frequentComplainer`, `risky_tld` →
  `riskyTld`, `spf_record` → `spfRecord`, `dmarc_record` → `dmarcRecord`, `smtp_score` → `smtpScore`,
  `overall_score` → `overallScore`, `spam_trap_score` → `spamTrapScore`, `result_type` →
  `resultType`, `sanitized_email` → `sanitizedEmail`, `first_seen` → `firstSeen`, `domain_age` →
  `domainAge`, `do_not_call` → `doNotCall`, `dialing_code` → `dialingCode`, `line_type` →
  `lineType`, `zip_code` → `zipCode`, `active_status` → `activeStatus`, `local_format` →
  `localFormat`). Email `firstSeen` / `domainAge` are `DateInfo | null`.
- `creditsRemaining: number | null` (`null` on batch items; set on single checks).
- `raw: Record<string, unknown>` — the `data` object exactly as returned (unknown fields included);
  `toJSON()` returns `raw`, so `JSON.stringify(result)` is the API data.
- `flagReasons(options?: { riskThreshold?: number; flagOn?: readonly string[] }): string[]` and
  `flagged(options?): boolean`: `fraudScore >= riskThreshold` (default 75) adds `"fraud_score"`;
  each name in `flagOn` (raw API field names) whose raw value `=== true` adds that name. Defaults
  (`static DEFAULT_FLAG_ON: readonly string[]`): IP `["proxy", "vpn", "tor"]`, email
  `["disposable"]`, phone `["VOIP", "risky"]`.

`DateInfo` is an interface `{ human: string | null; timestamp: number | null; iso: string | null }`;
`parseDateInfo(value: unknown): DateInfo | null` returns `null` for `null`/unsupported types, maps an
object's three keys with lenient coercion, and wraps a bare string as
`{ human: value, timestamp: null, iso: null }`.

Coercion (exported for tests from `results.ts`, not re-exported from `index.ts`): `coerceBool`
accepts only `boolean`; `coerceInt` accepts finite numbers (rounded half away from zero — `87.5` →
`88`, `-2.5` → `-3`) and whole-number or decimal strings (`"88"`, `"87.5"`), never booleans;
`coerceString` accepts only `string`. Anything else → `null`.

`BatchResult`: class with `readonly items: BatchItem[]`, `readonly creditsRemaining: number`,
`successful()`, `failed()`, `hasFailures()`, `get length()`, `[Symbol.iterator]()`,
`static fromEnvelope(envelope: Record<string, unknown>, kind: "ip" | "email" | "phone")`.
`BatchItem`: class with `readonly subject: string`, `readonly success: boolean`,
`readonly result: IpResult | EmailResult | PhoneResult | null`, `readonly error: string | null`,
`isInvalid()`, `isInsufficientCredits()`, `isUpstreamFailed()`.

### Errors (`src/errors.ts`)

```
FraudNovaError extends Error                               name = "FraudNovaError"
├── InvalidArgumentError                                   client-side input problems, no request sent
├── TransportError                                         fetch failed (timeout, DNS, TLS); cause = original
└── ApiError                                               statusCode: number, apiMessage: string, body: Record<string, unknown>
    ├── AuthenticationError        401 (envelope only)
    ├── InsufficientCreditsError   402 (envelope only)
    ├── AccountSuspendedError      403 (envelope only)
    ├── ValidationError            422 (envelope only)
    ├── RateLimitError             429 always; retryAfter: number | null (seconds); isConcurrencyLimit (getter)
    ├── UpstreamError              502/503/504; creditRefunded: boolean (true only for a 503 with the envelope)
    └── UnexpectedResponseError    a 2xx whose body is not the success envelope
```

Every class sets `this.name` to its class name. `error.message` is `"FraudNova API error (HTTP 429):
Rate limit exceeded. Try again shortly."`; for a non-JSON body it is `"FraudNova API error (HTTP
503): non-JSON response"`; `UpstreamError` appends `" The credit for this check was refunded."` when
`creditRefunded`. `apiMessage` is the envelope's `message` (or `error`) string when non-empty, else
the raw body trimmed and truncated to 200 characters, else `"HTTP <status>"`. "Envelope" means the
decoded JSON object has a `success` or `message` key — a Cloudflare JSON/HTML page with
401/402/403/422 is a plain `ApiError`. `RateLimitError.isConcurrencyLimit` is
`apiMessage.includes("Too many concurrent requests")`.
`ApiError.fromResponse(statusCode: number, text: string, retryAfter: number | null = null): ApiError`
does the envelope detection and subclass dispatch; the transport parses the header beforehand.

### Retry (opt-in)

`RetryPolicy` class, constructed from `RetryPolicyOptions { maxAttempts?: number (3);
concurrencyDelays?: readonly number[] ([1, 2, 4]); rateLimitDelays?: readonly number[] ([5, 15, 40]);
honourRetryAfter?: boolean (true); maxRetryAfter?: number (60); sleep?: (seconds: number) =>
Promise<void> }` (delays and `maxRetryAfter` in **seconds**, matching the Python SDK; the default
`sleep` is a promisified `setTimeout`). `maxAttempts < 1` or `maxRetryAfter < 0` throws
`InvalidArgumentError`. `delayFor(error: RateLimitError, attempt: number): number | null`
(attempt is 1-based, the one that just failed): `null` when `attempt >= maxAttempts`; else the
`Retry-After` value when honoured and present (`null` — stop — when it exceeds `maxRetryAfter`;
`0` is honoured); else the schedule entry `[attempt - 1]` for concurrency vs rate-limit, `null` when
the schedule runs out. `sleep(seconds)` awaits the configured sleeper. Only 429 is retried;
`balance()`/`myIp()`/batches use the same policy.
`parseRetryAfter(value: string | null, now: Date = new Date()): number | null` accepts delta-seconds
or an HTTP-date (`Date.parse`), clamped at 0, whole seconds (`Math.ceil` of the difference).

### Transport (internal)

`new Transport({ apiKey, baseUrl, timeout, retry, fetch })`; `get(path, params?, authenticated =
true): Promise<Record<string, unknown>>`, `post(path, json): Promise<Record<string, unknown>>`.
The 2xx body must parse to a JSON object with `success === true`; otherwise `UnexpectedResponseError`.
Callers (`FraudNova`) check for `data` / `results` / `credits_remaining` / `ip` and throw
`UnexpectedResponseError(status, "Missing data")` etc. when absent. Query strings are built with
`URLSearchParams`; the `fetch` function is called as `fetch(url, init)` with a plain `RequestInit`
(method, headers object, body string, signal), never a `Request` instance, so any fetch-compatible
double works.

## Quality bar

- vitest with an injected mock `fetch`; no test performs network I/O. `tests/helpers.ts` exposes
  `makeFetch(...queued)` → `{ fetch, calls: Array<{ url: string; init: RequestInit }> }` where each
  queued item is a `Response`, an `Error` to reject with, or a function `(url, init) => Response`;
  running out of queued items throws; and `jsonResponse(status, body, headers?)`.
- Coverage expectations: request building per endpoint (method, path, query encoding, JSON body,
  headers, no auth on `/my-ip`), chunking (250 items → 3 POSTs of 100/100/50, items concatenated,
  credits from the last, stop-at-zero), result parsing incl. missing/mistyped fields and the
  `DateInfo` shapes, every status → error class (envelope vs non-envelope), `Retry-After` parsing,
  retry schedule + sleeper calls + give-up + `maxRetryAfter`, batch parsing incl. all error codes
  and unknown codes, flagged defaults per type and custom thresholds, key masking in `inspect`,
  timeout → `TransportError`, leak guard, `VERSION` ↔ `package.json` ↔ CHANGELOG, README method
  names exist on `FraudNova.prototype`, built `dist/index.cjs` loads under `require()` and
  `dist/index.js` under `import()` and both expose `FraudNova`.
- `npm run lint` (eslint + `prettier --check`), `npm run typecheck`, `npm test`, `npm run build` clean.
- CI (`ci.yml`): matrix Node 18/20/22 on `ubuntu-24.04`: `npm ci`, lint, typecheck, test, build,
  `npm pack --dry-run`. Release (`release.yml`) on `v*.*.*` tags: Node 22, `npm ci`, a tag↔version
  gate (`v${package.json version}` must equal the tag), `npm install -g npm@latest` (OIDC Trusted
  Publishing needs npm ≥ 11.5), build + test, `npm publish --provenance --access public` with
  `permissions: id-token: write, contents: read` and **no `NPM_TOKEN`**, then a GitHub release with
  generated notes (`permissions: contents: write`).

## README outline

Title + one-paragraph pitch (same wording family as the Python README), badges (CI, npm version,
Node versions, licence), Requirements, Installation (`npm install @fraudnova/sdk`), Quickstart
(ESM, 4 lines, plus the CommonJS `require` form), Checking IPs/emails/phones (options objects),
Batch checks (chunking, stop-at-zero, per-item errors table), Results (properties, `raw`, `toJSON`,
`creditsRemaining`), The `flagged()` helper, Balance and your IP, Errors (error-class table), Retries,
Bring your own fetch (undici proxies, timeouts), Testing (inject a fake `fetch`), TypeScript (types
shipped, option types), Credits and limits, Resources, Licence.

## Release & hand-over

Single `main` branch, conventional-style commits, Keep-a-Changelog `CHANGELOG.md` with a `1.0.0`
section dated 2026-11-07. `docs/RELEASING.md` carries the owner's numbered steps: create the GitHub
repo, push, create the npm org `fraudnova` (or rename the package to `fraudnova`), configure the npm
trusted publisher (package `@fraudnova/sdk`, owner `dahleedam`, repository `fraudnova-node`, workflow
`release.yml`, no environment), tag `v1.0.0`, verify the registry with
`curl "https://registry.npmjs.org/@fraudnova%2Fsdk?write=true"` (never trust the CLI's success line)
and `npm install @fraudnova/sdk` in an empty directory.

Main-app follow-ups (same session, separate repos): `/docs#node-sdk` section + a "Node.js SDK" tab on
all six code-sample groups, changelog seeder entry `node-sdk` (Improved, 2026-11-08),
`docs/DEPLOY.md` note, examples README link.
