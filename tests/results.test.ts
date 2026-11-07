import { describe, expect, it } from "vitest";
import { BatchResult, EmailResult, IpResult, PhoneResult, parseDateInfo } from "../src/index.js";
import { coerceInt } from "../src/results.js";

const ipFixture = {
  fraud_score: 88,
  proxy: true,
  vpn: false,
  tor: false,
  active_vpn: false,
  active_tor: false,
  recent_abuse: true,
  bot_status: false,
  country_code: "US",
  region: "Texas",
  city: "Dallas",
  ISP: "Example ISP",
  organization: "Example Org",
  ASN: 64500,
  operating_system: "Windows 10",
  browser: "Chrome 120",
  device_brand: "Dell",
  device_model: "XPS",
  extra: "kept",
};

describe("coerceInt", () => {
  it("coerces numbers and numeric strings", () => {
    expect(coerceInt(5)).toBe(5);
    expect(coerceInt("88")).toBe(88);
    expect(coerceInt(87.5)).toBe(88);
    expect(coerceInt("87.5")).toBe(88);
    expect(coerceInt(-2.5)).toBe(-3);
  });

  it("rejects everything else", () => {
    expect(coerceInt(true)).toBeNull();
    expect(coerceInt("abc")).toBeNull();
    expect(coerceInt(Number.NaN)).toBeNull();
    expect(coerceInt(Number.POSITIVE_INFINITY)).toBeNull();
    expect(coerceInt(null)).toBeNull();
    expect(coerceInt(undefined)).toBeNull();
  });
});

describe("IpResult", () => {
  it("maps every field", () => {
    const r = IpResult.fromData(ipFixture, 42);
    expect(r.fraudScore).toBe(88);
    expect(r.proxy).toBe(true);
    expect(r.vpn).toBe(false);
    expect(r.recentAbuse).toBe(true);
    expect(r.countryCode).toBe("US");
    expect(r.isp).toBe("Example ISP");
    expect(r.asn).toBe(64500);
    expect(r.operatingSystem).toBe("Windows 10");
    expect(r.deviceModel).toBe("XPS");
    expect(r.creditsRemaining).toBe(42);
    expect(r.raw).toBe(ipFixture);
    expect(JSON.stringify(r)).toBe(JSON.stringify(ipFixture));
  });

  it("defaults missing fields to null and a zero score", () => {
    const r = IpResult.fromData({});
    expect(r.fraudScore).toBe(0);
    expect(r.proxy).toBeNull();
    expect(r.isp).toBeNull();
    expect(r.asn).toBeNull();
    expect(r.creditsRemaining).toBeNull();
  });

  it("nulls a mistyped field but keeps it in raw", () => {
    const r = IpResult.fromData({ proxy: "yes" });
    expect(r.proxy).toBeNull();
    expect(r.raw.proxy).toBe("yes");
  });

  it("flags a fractional score", () => {
    const r = IpResult.fromData({ fraud_score: 87.5 });
    expect(r.flagged()).toBe(true);
    expect(r.flagReasons()).toEqual(["fraud_score"]);
  });

  it("uses per-type flag defaults", () => {
    expect(IpResult.fromData({ proxy: true }).flagReasons()).toEqual(["proxy"]);
    expect(EmailResult.fromData({ disposable: true }).flagReasons()).toEqual(["disposable"]);
    expect(PhoneResult.fromData({ VOIP: true }).flagReasons()).toEqual(["VOIP"]);
    expect(IpResult.fromData({ vpn: 1 }).flagged()).toBe(false);
  });

  it("honours a custom threshold and flagOn", () => {
    const r = IpResult.fromData({ fraud_score: 60, proxy: true, recent_abuse: true });
    expect(r.flagReasons({ riskThreshold: 50, flagOn: ["recent_abuse"] })).toEqual([
      "fraud_score",
      "recent_abuse",
    ]);
    expect(r.flagReasons({ flagOn: [] })).toEqual([]);
  });
});

describe("EmailResult", () => {
  it("parses date fields", () => {
    const date = { human: "3 years ago", timestamp: 1600000000, iso: "2020-09-13T12:26:40+00:00" };
    const r = EmailResult.fromData({ first_seen: date, domain_age: "2020-09-13" });
    expect(r.firstSeen).toEqual(date);
    expect(r.domainAge).toEqual({ human: "2020-09-13", timestamp: null, iso: null });
    expect(parseDateInfo(null)).toBeNull();
    expect(parseDateInfo(7)).toBeNull();
  });
});

describe("PhoneResult", () => {
  it("maps VOIP and strings", () => {
    const r = PhoneResult.fromData({ VOIP: true, dialing_code: 1, local_format: "(817) 679-1808" });
    expect(r.voip).toBe(true);
    expect(r.dialingCode).toBe(1);
    expect(r.localFormat).toBe("(817) 679-1808");
  });
});

describe("BatchResult", () => {
  it("parses items and helpers", () => {
    const b = BatchResult.fromEnvelope(
      {
        credits_remaining: 90,
        results: [
          { ip: "1.1.1.1", success: true, data: { fraud_score: 10 } },
          { ip: "bad", success: false, error: "invalid_ip" },
          { ip: "2.2.2.2", success: false, error: "insufficient_credits" },
          { ip: "3.3.3.3", success: false, error: "upstream_failed" },
          { ip: "4.4.4.4", success: false, error: "weird" },
        ],
      },
      "ip",
    );
    expect(b.length).toBe(5);
    expect([...b]).toHaveLength(5);
    expect(b.items[0]?.result).toBeInstanceOf(IpResult);
    expect(b.items[0]?.subject).toBe("1.1.1.1");
    expect(b.successful()).toHaveLength(1);
    expect(b.failed()).toHaveLength(4);
    expect(b.hasFailures()).toBe(true);
    expect(b.items[1]?.isInvalid()).toBe(true);
    expect(b.items[2]?.isInsufficientCredits()).toBe(true);
    expect(b.items[3]?.isUpstreamFailed()).toBe(true);
    expect(b.items[4]?.isInvalid()).toBe(false);
    expect(b.creditsRemaining).toBe(90);
  });

  it("gives a successful item without data a null result", () => {
    const b = BatchResult.fromEnvelope({ results: [{ email: "a@b.c", success: true }] }, "email");
    expect(b.items[0]?.result).toBeNull();
    expect(b.items[0]?.success).toBe(true);
  });

  it("tolerates garbage", () => {
    expect(BatchResult.fromEnvelope({}, "ip").length).toBe(0);
    const b = BatchResult.fromEnvelope(
      { results: [5, null, [], { ip: "1.1.1.1", success: "yes" }] },
      "ip",
    );
    expect(b.length).toBe(1);
    expect(b.items[0]?.success).toBe(false);
    expect(b.creditsRemaining).toBe(0);
  });
});
