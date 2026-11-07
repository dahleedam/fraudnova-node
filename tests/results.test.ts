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
    expect(r.tor).toBe(false);
    expect(r.activeVpn).toBe(false);
    expect(r.activeTor).toBe(false);
    expect(r.recentAbuse).toBe(true);
    expect(r.botStatus).toBe(false);
    expect(r.countryCode).toBe("US");
    expect(r.region).toBe("Texas");
    expect(r.city).toBe("Dallas");
    expect(r.isp).toBe("Example ISP");
    expect(r.organization).toBe("Example Org");
    expect(r.asn).toBe(64500);
    expect(r.operatingSystem).toBe("Windows 10");
    expect(r.browser).toBe("Chrome 120");
    expect(r.deviceBrand).toBe("Dell");
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
  it("maps every field", () => {
    const fixture = {
      fraud_score: 61,
      valid: true,
      disposable: false,
      catch_all: true,
      generic: false,
      common: true,
      dns_valid: false,
      honeypot: true,
      frequent_complainer: false,
      suspect: true,
      recent_abuse: false,
      leaked: true,
      risky_tld: false,
      spf_record: true,
      dmarc_record: false,
      smtp_score: 3,
      overall_score: 4,
      deliverability: "medium",
      spam_trap_score: "low",
      result_type: "mailbox",
      sanitized_email: "jane.doe@example.org",
      first_seen: { human: "2 years ago", timestamp: 1700000001, iso: "2023-11-14T22:13:21+00:00" },
      domain_age: { human: "9 years ago", timestamp: 1500000002, iso: "2017-07-14T02:40:02+00:00" },
      extra: "kept",
    };
    const r = EmailResult.fromData(fixture, 17);
    expect(r.fraudScore).toBe(61);
    expect(r.valid).toBe(true);
    expect(r.disposable).toBe(false);
    expect(r.catchAll).toBe(true);
    expect(r.generic).toBe(false);
    expect(r.common).toBe(true);
    expect(r.dnsValid).toBe(false);
    expect(r.honeypot).toBe(true);
    expect(r.frequentComplainer).toBe(false);
    expect(r.suspect).toBe(true);
    expect(r.recentAbuse).toBe(false);
    expect(r.leaked).toBe(true);
    expect(r.riskyTld).toBe(false);
    expect(r.spfRecord).toBe(true);
    expect(r.dmarcRecord).toBe(false);
    expect(r.smtpScore).toBe(3);
    expect(r.overallScore).toBe(4);
    expect(r.deliverability).toBe("medium");
    expect(r.spamTrapScore).toBe("low");
    expect(r.resultType).toBe("mailbox");
    expect(r.sanitizedEmail).toBe("jane.doe@example.org");
    expect(r.firstSeen).toEqual({
      human: "2 years ago",
      timestamp: 1700000001,
      iso: "2023-11-14T22:13:21+00:00",
    });
    expect(r.domainAge).toEqual({
      human: "9 years ago",
      timestamp: 1500000002,
      iso: "2017-07-14T02:40:02+00:00",
    });
    expect(r.creditsRemaining).toBe(17);
    expect(r.raw).toBe(fixture);
    expect(JSON.stringify(r)).toBe(JSON.stringify(fixture));
  });

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
  it("maps every field", () => {
    const fixture = {
      fraud_score: 47,
      valid: true,
      recent_abuse: false,
      VOIP: true,
      prepaid: false,
      risky: true,
      active: false,
      do_not_call: true,
      leaked: false,
      spammer: true,
      dialing_code: 44,
      carrier: "Example Mobile",
      line_type: "Wireless",
      country: "GB",
      region: "England",
      city: "Leeds",
      timezone: "Europe/London",
      zip_code: "LS1 4AP",
      active_status: "N/A",
      formatted: "+447700900123",
      local_format: "07700 900123",
      extra: "kept",
    };
    const r = PhoneResult.fromData(fixture, 23);
    expect(r.fraudScore).toBe(47);
    expect(r.valid).toBe(true);
    expect(r.recentAbuse).toBe(false);
    expect(r.voip).toBe(true);
    expect(r.prepaid).toBe(false);
    expect(r.risky).toBe(true);
    expect(r.active).toBe(false);
    expect(r.doNotCall).toBe(true);
    expect(r.leaked).toBe(false);
    expect(r.spammer).toBe(true);
    expect(r.dialingCode).toBe(44);
    expect(r.carrier).toBe("Example Mobile");
    expect(r.lineType).toBe("Wireless");
    expect(r.country).toBe("GB");
    expect(r.region).toBe("England");
    expect(r.city).toBe("Leeds");
    expect(r.timezone).toBe("Europe/London");
    expect(r.zipCode).toBe("LS1 4AP");
    expect(r.activeStatus).toBe("N/A");
    expect(r.formatted).toBe("+447700900123");
    expect(r.localFormat).toBe("07700 900123");
    expect(r.creditsRemaining).toBe(23);
    expect(r.raw).toBe(fixture);
    expect(JSON.stringify(r)).toBe(JSON.stringify(fixture));
  });

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

type BoolTable = Array<[string, string]>;

const ipBools: BoolTable = [
  ["proxy", "proxy"],
  ["vpn", "vpn"],
  ["tor", "tor"],
  ["active_vpn", "activeVpn"],
  ["active_tor", "activeTor"],
  ["recent_abuse", "recentAbuse"],
  ["bot_status", "botStatus"],
];

const emailBools: BoolTable = [
  ["valid", "valid"],
  ["disposable", "disposable"],
  ["catch_all", "catchAll"],
  ["generic", "generic"],
  ["common", "common"],
  ["dns_valid", "dnsValid"],
  ["honeypot", "honeypot"],
  ["frequent_complainer", "frequentComplainer"],
  ["suspect", "suspect"],
  ["recent_abuse", "recentAbuse"],
  ["leaked", "leaked"],
  ["risky_tld", "riskyTld"],
  ["spf_record", "spfRecord"],
  ["dmarc_record", "dmarcRecord"],
];

const phoneBools: BoolTable = [
  ["valid", "valid"],
  ["recent_abuse", "recentAbuse"],
  ["VOIP", "voip"],
  ["prepaid", "prepaid"],
  ["risky", "risky"],
  ["active", "active"],
  ["do_not_call", "doNotCall"],
  ["leaked", "leaked"],
  ["spammer", "spammer"],
];

function expectIsolated(build: (raw: Record<string, unknown>) => object, table: BoolTable): void {
  for (const [rawKey, field] of table) {
    const result = build({ [rawKey]: true }) as Record<string, unknown>;
    for (const [, other] of table) {
      expect(result[other], `${rawKey} -> ${other}`).toBe(other === field ? true : null);
    }
  }
}

describe("mapping isolation", () => {
  it("maps each IpResult boolean key to exactly one field", () => {
    expectIsolated((raw) => IpResult.fromData(raw), ipBools);
  });

  it("maps each EmailResult boolean key to exactly one field", () => {
    expectIsolated((raw) => EmailResult.fromData(raw), emailBools);
  });

  it("maps each PhoneResult boolean key to exactly one field", () => {
    expectIsolated((raw) => PhoneResult.fromData(raw), phoneBools);
  });
});

describe("non-object data", () => {
  it("treats null as an empty IpResult", () => {
    const r = IpResult.fromData(null as never);
    expect(r.raw).toEqual({});
    expect(r.fraudScore).toBe(0);
    expect(r.proxy).toBeNull();
    expect(r.countryCode).toBeNull();
    expect(r.asn).toBeNull();
  });

  it("treats undefined as an empty EmailResult", () => {
    const r = EmailResult.fromData(undefined as never);
    expect(r.raw).toEqual({});
    expect(r.fraudScore).toBe(0);
    expect(r.valid).toBeNull();
    expect(r.deliverability).toBeNull();
    expect(r.firstSeen).toBeNull();
  });

  it("treats a string as an empty PhoneResult", () => {
    const r = PhoneResult.fromData("x" as never);
    expect(r.raw).toEqual({});
    expect(r.fraudScore).toBe(0);
    expect(r.voip).toBeNull();
    expect(r.carrier).toBeNull();
    expect(r.dialingCode).toBeNull();
  });

  it("treats an array as an empty IpResult", () => {
    const r = IpResult.fromData([] as never);
    expect(r.raw).toEqual({});
    expect(Array.isArray(r.raw)).toBe(false);
    expect(r.fraudScore).toBe(0);
    expect(r.vpn).toBeNull();
    expect(r.city).toBeNull();
  });
});
