import { inspect } from "node:util";
import { describe, expect, test } from "vitest";
import { BATCH_MAX, DEFAULT_BASE_URL, FraudNova } from "../src/client.js";
import { InvalidArgumentError, UnexpectedResponseError, UpstreamError } from "../src/errors.js";
import { EmailResult, IpResult, PhoneResult } from "../src/results.js";
import { RetryPolicy } from "../src/retry.js";
import { jsonResponse, makeFetch } from "./helpers.js";

const KEY = "fn_test_key_1234567890";
const BASE = "https://fraudnova.com/api/v1";

type Queued = Parameters<typeof makeFetch>[number];

function make(...queued: Queued[]) {
  const { fetch, calls } = makeFetch(...queued);
  const client = new FraudNova(KEY, { fetch });
  return { client, calls };
}

function headersOf(init: RequestInit): Record<string, string> {
  return init.headers as Record<string, string>;
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function ipBatch(ips: Array<string | null>, credits: number) {
  return jsonResponse(200, {
    success: true,
    credits_remaining: credits,
    results: ips.map((ip) => ({ ip, success: true, data: { fraud_score: 5 } })),
  });
}

describe("FraudNova", () => {
  test("exports the constants", () => {
    expect(BATCH_MAX).toBe(100);
    expect(DEFAULT_BASE_URL).toBe(BASE);
  });

  test("the constructor validates its arguments", () => {
    const { fetch } = makeFetch();
    expect(() => new FraudNova("", { fetch })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova("  ", { fetch })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova(42 as never, { fetch })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova(KEY, { fetch, baseUrl: "ftp://x" })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova(KEY, { fetch, timeout: 0 })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova(KEY, { fetch, timeout: NaN })).toThrow(InvalidArgumentError);
    expect(() => new FraudNova(KEY, { fetch, timeout: 2_147_483_648 })).toThrow(
      InvalidArgumentError,
    );
    expect(new FraudNova(KEY, { fetch, baseUrl: "HTTPS://api.test/v1/" }).baseUrl).toBe(
      "HTTPS://api.test/v1",
    );
    expect(new FraudNova(KEY, { fetch }).baseUrl).toBe(BASE);
  });

  test("inspect and String never show the key", () => {
    const { client } = make();
    const expected = `FraudNova { apiKey: "fn_…7890", baseUrl: "${BASE}" }`;
    expect(inspect(client)).toBe(expected);
    expect(String(client)).toBe(expected);
    expect(JSON.stringify(client)).not.toContain(KEY);
    expect(Object.keys(client).join(",")).not.toContain("apiKey");
    expect(JSON.stringify(Object.values(client))).not.toContain(KEY);
  });

  test("the trimmed key is sent as the bearer token", async () => {
    const { fetch, calls } = makeFetch(jsonResponse(200, { success: true, credits_remaining: 3 }));
    await new FraudNova(`  ${KEY} `, { fetch }).balance();
    expect(headersOf(calls[0].init).Authorization).toBe(`Bearer ${KEY}`);
  });

  test("checkIp sends only the given options", async () => {
    const { client, calls } = make(
      jsonResponse(200, { success: true, data: { fraud_score: 1 } }),
      jsonResponse(200, { success: true, data: { fraud_score: 1 } }),
    );
    await client.checkIp(" 8.8.8.8 ", {
      strictness: 2,
      mobile: false,
      userAgent: "UA",
      userLanguage: "en-US",
    });
    expect(calls[0].url).toBe(
      `${BASE}/check?ip=8.8.8.8&strictness=2&mobile=false&user_agent=UA&user_language=en-US`,
    );
    expect(calls[0].init.method).toBe("GET");
    await client.checkIp("8.8.8.8");
    expect(calls[1].url).toBe(`${BASE}/check?ip=8.8.8.8`);
  });

  test("checkIp returns an IpResult with creditsRemaining", async () => {
    const { client } = make(
      jsonResponse(200, { success: true, credits_remaining: 41, data: { fraud_score: 88 } }),
    );
    const result = await client.checkIp("8.8.8.8");
    expect(result).toBeInstanceOf(IpResult);
    expect(result.fraudScore).toBe(88);
    expect(result.creditsRemaining).toBe(41);
  });

  test("an empty or invalid subject rejects before any request", async () => {
    const { client, calls } = make();
    await expect(client.checkIp("")).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(client.checkEmail("  ")).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(client.checkPhone(null as never)).rejects.toBeInstanceOf(InvalidArgumentError);
    await expect(client.checkIp("")).rejects.toThrow("ip must be a non-empty string");
    expect(calls.length).toBe(0);
  });

  test("strictness is validated", async () => {
    const { client, calls } = make();
    for (const value of [4, 1.5, "2", -1]) {
      await expect(
        client.checkIp("8.8.8.8", { strictness: value as never }),
      ).rejects.toBeInstanceOf(InvalidArgumentError);
      await expect(client.checkIps(["8.8.8.8"], { strictness: value as never })).rejects.toThrow(
        "strictness must be an integer from 0 to 3",
      );
    }
    expect(calls.length).toBe(0);
  });

  test("checkEmail and checkPhone build their requests", async () => {
    const { client, calls } = make(
      jsonResponse(200, { success: true, credits_remaining: 9, data: { fraud_score: 3 } }),
      jsonResponse(200, { success: true, data: { fraud_score: 4 } }),
      jsonResponse(200, { success: true, data: { fraud_score: 4 } }),
    );
    const email = await client.checkEmail(" user@example.com ");
    expect(email).toBeInstanceOf(EmailResult);
    expect(email.creditsRemaining).toBe(9);
    expect(calls[0].url).toBe(`${BASE}/check/email?email=user%40example.com`);
    const phone = await client.checkPhone("18176791808", { country: " us " });
    expect(phone).toBeInstanceOf(PhoneResult);
    expect(calls[1].url).toBe(`${BASE}/check/phone?phone=18176791808&country=US`);
    await client.checkPhone("18176791808", { country: "  " });
    expect(calls[2].url).toBe(`${BASE}/check/phone?phone=18176791808`);
  });

  test("a 2xx without data is an UnexpectedResponseError", async () => {
    const { client } = make(jsonResponse(200, { success: true }));
    const error = await client.checkIp("8.8.8.8").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect((error as UnexpectedResponseError).apiMessage).toBe("Missing data");
  });

  test("checkIps posts a JSON body with options", async () => {
    const { client, calls } = make(ipBatch(["8.8.8.8", null, ""], 7));
    const batch = await client.checkIps([" 8.8.8.8 ", null, ""], { strictness: 2, mobile: true });
    expect(calls[0].url).toBe(`${BASE}/check/batch`);
    expect(calls[0].init.method).toBe("POST");
    expect(headersOf(calls[0].init)["Content-Type"]).toBe("application/json");
    expect(bodyOf(calls[0].init)).toEqual({
      ips: ["8.8.8.8", null, ""],
      strictness: 2,
      mobile: true,
    });
    expect(batch.length).toBe(3);
    expect(batch.creditsRemaining).toBe(7);
  });

  test("checkIps chunks by 100", async () => {
    const ips = Array.from({ length: 250 }, (_, i) => `10.0.${Math.floor(i / 256)}.${i % 256}`);
    const { client, calls } = make(
      ipBatch(ips.slice(0, 100), 500),
      ipBatch(ips.slice(100, 200), 400),
      ipBatch(ips.slice(200), 350),
    );
    const batch = await client.checkIps(ips);
    expect(calls.length).toBe(3);
    expect(calls.map((c) => (bodyOf(c.init).ips as unknown[]).length)).toEqual([100, 100, 50]);
    expect(batch.length).toBe(250);
    expect(batch.items.map((i) => i.subject)).toEqual(ips);
    expect(batch.creditsRemaining).toBe(350);
  });

  test("checkIps stops when credits hit zero", async () => {
    const ips = Array.from({ length: 150 }, (_, i) => `10.0.0.${i}`);
    const { client, calls } = make(ipBatch(ips.slice(0, 100), 0));
    const batch = await client.checkIps([...ips.slice(0, 149), null]);
    expect(calls.length).toBe(1);
    expect(batch.length).toBe(150);
    const tail = batch.items.slice(100);
    expect(tail.every((i) => !i.success && i.error === "insufficient_credits")).toBe(true);
    expect(tail.every((i) => i.result === null)).toBe(true);
    expect(tail[0].subject).toBe("10.0.0.100");
    expect(tail[49].subject).toBe("");
    expect(batch.creditsRemaining).toBe(0);
  });

  test("zero credits on the last chunk adds no phantom items", async () => {
    const ips = Array.from({ length: 150 }, (_, i) => `10.0.0.${i}`);
    const { client, calls } = make(ipBatch(ips.slice(0, 100), 20), ipBatch(ips.slice(100), 0));
    const batch = await client.checkIps(ips);
    expect(calls.length).toBe(2);
    expect(batch.length).toBe(150);
    expect(batch.items.map((i) => i.subject)).toEqual(ips);
    expect(batch.items.every((i) => i.success && i.error === null)).toBe(true);
    expect(batch.creditsRemaining).toBe(0);
  });

  test("a non-last chunk without credits_remaining keeps going", async () => {
    const ips = Array.from({ length: 150 }, (_, i) => `10.0.0.${i}`);
    const first = jsonResponse(200, {
      success: true,
      results: ips.slice(0, 100).map((ip) => ({ ip, success: true, data: { fraud_score: 5 } })),
    });
    const { client, calls } = make(first, ipBatch(ips.slice(100), 17));
    const batch = await client.checkIps(ips);
    expect(calls.length).toBe(2);
    expect((bodyOf(calls[1].init).ips as unknown[]).length).toBe(50);
    expect(batch.length).toBe(150);
    expect(batch.items.every((i) => i.success)).toBe(true);
    expect(batch.creditsRemaining).toBe(17);
  });

  test("an error on a later chunk propagates", async () => {
    const ips = Array.from({ length: 150 }, (_, i) => `10.0.0.${i}`);
    const { client, calls } = make(
      ipBatch(ips.slice(0, 100), 50),
      jsonResponse(503, { success: false, message: "Upstream lookup failed." }),
    );
    await expect(client.checkIps(ips)).rejects.toBeInstanceOf(UpstreamError);
    expect(calls.length).toBe(2);
  });

  test("batch input is validated", async () => {
    const { client, calls } = make();
    await expect(client.checkIps([])).rejects.toThrow("ips must not be empty");
    await expect(client.checkIps("8.8.8.8" as never)).rejects.toThrow(
      "ips must be an array of values",
    );
    await expect(client.checkIps([1] as never)).rejects.toThrow("ips[0] must be a string or null");
    await expect(client.checkEmails([] as never)).rejects.toBeInstanceOf(InvalidArgumentError);
    expect(calls.length).toBe(0);
  });

  test("checkEmails and checkPhones use their endpoints", async () => {
    const { client, calls } = make(
      jsonResponse(200, {
        success: true,
        credits_remaining: 5,
        results: [{ email: "a@b.co", success: true, data: { fraud_score: 2 } }],
      }),
      jsonResponse(200, {
        success: true,
        credits_remaining: 4,
        results: [{ phone: "18176791808", success: false, error: "invalid_phone" }],
      }),
      jsonResponse(200, { success: true, credits_remaining: 3, results: [] }),
    );
    const emails = await client.checkEmails([" a@b.co "]);
    expect(calls[0].url).toBe(`${BASE}/check/email/batch`);
    expect(bodyOf(calls[0].init)).toEqual({ emails: ["a@b.co"] });
    expect(emails.items[0].result).toBeInstanceOf(EmailResult);
    const phones = await client.checkPhones(["18176791808"], { country: "us" });
    expect(calls[1].url).toBe(`${BASE}/check/phone/batch`);
    expect(bodyOf(calls[1].init)).toEqual({ phones: ["18176791808"], country: "US" });
    expect(phones.items[0].isInvalid()).toBe(true);
    await client.checkPhones(["18176791808"]);
    expect(bodyOf(calls[2].init)).toEqual({ phones: ["18176791808"] });
  });

  test("a batch without results is an UnexpectedResponseError", async () => {
    const { client } = make(jsonResponse(200, { success: true, credits_remaining: 5 }));
    const error = await client.checkIps(["8.8.8.8"]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect((error as UnexpectedResponseError).apiMessage).toBe("Missing results");
  });

  test("balance returns the number and rejects when missing", async () => {
    const { client, calls } = make(
      jsonResponse(200, { success: true, credits_remaining: 123 }),
      jsonResponse(200, { success: true }),
    );
    expect(await client.balance()).toBe(123);
    expect(calls[0].url).toBe(`${BASE}/balance`);
    expect(headersOf(calls[0].init).Authorization).toBe(`Bearer ${KEY}`);
    const error = await client.balance().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnexpectedResponseError);
    expect((error as UnexpectedResponseError).apiMessage).toBe("Missing credits_remaining");
  });

  test("myIp sends no Authorization header and returns the ip", async () => {
    const { client, calls } = make(
      jsonResponse(200, { success: true, ip: "203.0.113.9" }),
      jsonResponse(200, { success: true }),
      jsonResponse(200, { success: true, ip: 42 }),
    );
    expect(await client.myIp()).toBe("203.0.113.9");
    expect(calls[0].url).toBe(`${BASE}/my-ip`);
    expect(headersOf(calls[0].init).Authorization).toBeUndefined();
    for (let i = 0; i < 2; i++) {
      const error = await client.myIp().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnexpectedResponseError);
      expect((error as UnexpectedResponseError).apiMessage).toBe("Missing ip");
    }
  });

  test("the retry policy is passed to the transport", async () => {
    const sleeps: number[] = [];
    const { fetch, calls } = makeFetch(
      jsonResponse(429, { success: false, message: "Rate limit exceeded. Try again shortly." }),
      jsonResponse(200, { success: true, credits_remaining: 8 }),
    );
    const retry = new RetryPolicy({
      maxAttempts: 2,
      sleep: (seconds) => {
        sleeps.push(seconds);
        return Promise.resolve();
      },
    });
    const client = new FraudNova(KEY, { fetch, retry });
    expect(await client.balance()).toBe(8);
    expect(calls.length).toBe(2);
    expect(sleeps.length).toBe(1);
  });
});
