/** Typed, leniently parsed results for IP, email and phone checks. */

type Raw = Record<string, unknown>;

export function coerceBool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

export function coerceString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function roundHalfAway(n: number): number {
  const r = Math.sign(n) * Math.floor(Math.abs(n) + 0.5);
  return r === 0 ? 0 : r;
}

export function coerceInt(v: unknown): number | null {
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string" && (/^-?\d+$/.test(v) || /^-?\d+\.\d+$/.test(v))) {
    n = Number(v);
  } else {
    return null;
  }
  return Number.isFinite(n) ? roundHalfAway(n) : null;
}

function isPlainObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Treat anything that is not a plain object as `{}`, so a malformed `data` yields defaults. */
function asRaw(data: unknown): Raw {
  return isPlainObject(data) ? data : {};
}

export interface DateInfo {
  human: string | null;
  timestamp: number | null;
  iso: string | null;
}

export function parseDateInfo(value: unknown): DateInfo | null {
  if (typeof value === "string") {
    return { human: value, timestamp: null, iso: null };
  }
  if (isPlainObject(value)) {
    return {
      human: coerceString(value.human),
      timestamp: coerceInt(value.timestamp),
      iso: coerceString(value.iso),
    };
  }
  return null;
}

export interface FlagOptions {
  riskThreshold?: number;
  flagOn?: readonly string[];
}

export type CheckKind = "ip" | "email" | "phone";

abstract class FlaggableResult {
  readonly creditsRemaining: number | null;
  readonly raw: Raw;

  protected constructor(raw: Raw, creditsRemaining: number | null) {
    this.raw = raw;
    this.creditsRemaining = creditsRemaining;
  }

  protected abstract defaultFlagOn(): readonly string[];

  toJSON(): Raw {
    return this.raw;
  }

  flagReasons(options: FlagOptions = {}): string[] {
    const threshold = options.riskThreshold ?? 75;
    const reasons: string[] = [];
    if ((coerceInt(this.raw.fraud_score) ?? 0) >= threshold) {
      reasons.push("fraud_score");
    }
    for (const name of options.flagOn ?? this.defaultFlagOn()) {
      if (this.raw[name] === true) {
        reasons.push(name);
      }
    }
    return reasons;
  }

  flagged(options: FlagOptions = {}): boolean {
    return this.flagReasons(options).length > 0;
  }
}

export class IpResult extends FlaggableResult {
  static readonly DEFAULT_FLAG_ON: readonly string[] = ["proxy", "vpn", "tor"];

  readonly fraudScore: number;
  readonly proxy: boolean | null;
  readonly vpn: boolean | null;
  readonly tor: boolean | null;
  readonly activeVpn: boolean | null;
  readonly activeTor: boolean | null;
  readonly recentAbuse: boolean | null;
  readonly botStatus: boolean | null;
  readonly countryCode: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly isp: string | null;
  readonly organization: string | null;
  readonly asn: number | null;
  readonly operatingSystem: string | null;
  readonly browser: string | null;
  readonly deviceBrand: string | null;
  readonly deviceModel: string | null;

  private constructor(raw: Raw, creditsRemaining: number | null) {
    super(raw, creditsRemaining);
    this.fraudScore = coerceInt(raw.fraud_score) ?? 0;
    this.proxy = coerceBool(raw.proxy);
    this.vpn = coerceBool(raw.vpn);
    this.tor = coerceBool(raw.tor);
    this.activeVpn = coerceBool(raw.active_vpn);
    this.activeTor = coerceBool(raw.active_tor);
    this.recentAbuse = coerceBool(raw.recent_abuse);
    this.botStatus = coerceBool(raw.bot_status);
    this.countryCode = coerceString(raw.country_code);
    this.region = coerceString(raw.region);
    this.city = coerceString(raw.city);
    this.isp = coerceString(raw.ISP);
    this.organization = coerceString(raw.organization);
    this.asn = coerceInt(raw.ASN);
    this.operatingSystem = coerceString(raw.operating_system);
    this.browser = coerceString(raw.browser);
    this.deviceBrand = coerceString(raw.device_brand);
    this.deviceModel = coerceString(raw.device_model);
  }

  static fromData(data: Raw, creditsRemaining: number | null = null): IpResult {
    return new IpResult(asRaw(data), creditsRemaining);
  }

  protected defaultFlagOn(): readonly string[] {
    return IpResult.DEFAULT_FLAG_ON;
  }
}

export class EmailResult extends FlaggableResult {
  static readonly DEFAULT_FLAG_ON: readonly string[] = ["disposable"];

  readonly fraudScore: number;
  readonly valid: boolean | null;
  readonly disposable: boolean | null;
  readonly catchAll: boolean | null;
  readonly generic: boolean | null;
  readonly common: boolean | null;
  readonly dnsValid: boolean | null;
  readonly honeypot: boolean | null;
  readonly frequentComplainer: boolean | null;
  readonly suspect: boolean | null;
  readonly recentAbuse: boolean | null;
  readonly leaked: boolean | null;
  readonly riskyTld: boolean | null;
  readonly spfRecord: boolean | null;
  readonly dmarcRecord: boolean | null;
  readonly smtpScore: number | null;
  readonly overallScore: number | null;
  readonly deliverability: string | null;
  readonly spamTrapScore: string | null;
  readonly resultType: string | null;
  readonly sanitizedEmail: string | null;
  readonly firstSeen: DateInfo | null;
  readonly domainAge: DateInfo | null;

  private constructor(raw: Raw, creditsRemaining: number | null) {
    super(raw, creditsRemaining);
    this.fraudScore = coerceInt(raw.fraud_score) ?? 0;
    this.valid = coerceBool(raw.valid);
    this.disposable = coerceBool(raw.disposable);
    this.catchAll = coerceBool(raw.catch_all);
    this.generic = coerceBool(raw.generic);
    this.common = coerceBool(raw.common);
    this.dnsValid = coerceBool(raw.dns_valid);
    this.honeypot = coerceBool(raw.honeypot);
    this.frequentComplainer = coerceBool(raw.frequent_complainer);
    this.suspect = coerceBool(raw.suspect);
    this.recentAbuse = coerceBool(raw.recent_abuse);
    this.leaked = coerceBool(raw.leaked);
    this.riskyTld = coerceBool(raw.risky_tld);
    this.spfRecord = coerceBool(raw.spf_record);
    this.dmarcRecord = coerceBool(raw.dmarc_record);
    this.smtpScore = coerceInt(raw.smtp_score);
    this.overallScore = coerceInt(raw.overall_score);
    this.deliverability = coerceString(raw.deliverability);
    this.spamTrapScore = coerceString(raw.spam_trap_score);
    this.resultType = coerceString(raw.result_type);
    this.sanitizedEmail = coerceString(raw.sanitized_email);
    this.firstSeen = parseDateInfo(raw.first_seen);
    this.domainAge = parseDateInfo(raw.domain_age);
  }

  static fromData(data: Raw, creditsRemaining: number | null = null): EmailResult {
    return new EmailResult(asRaw(data), creditsRemaining);
  }

  protected defaultFlagOn(): readonly string[] {
    return EmailResult.DEFAULT_FLAG_ON;
  }
}

export class PhoneResult extends FlaggableResult {
  static readonly DEFAULT_FLAG_ON: readonly string[] = ["VOIP", "risky"];

  readonly fraudScore: number;
  readonly valid: boolean | null;
  readonly recentAbuse: boolean | null;
  readonly voip: boolean | null;
  readonly prepaid: boolean | null;
  readonly risky: boolean | null;
  readonly active: boolean | null;
  readonly doNotCall: boolean | null;
  readonly leaked: boolean | null;
  readonly spammer: boolean | null;
  readonly dialingCode: number | null;
  readonly carrier: string | null;
  readonly lineType: string | null;
  readonly country: string | null;
  readonly region: string | null;
  readonly city: string | null;
  readonly timezone: string | null;
  readonly zipCode: string | null;
  readonly activeStatus: string | null;
  readonly formatted: string | null;
  readonly localFormat: string | null;

  private constructor(raw: Raw, creditsRemaining: number | null) {
    super(raw, creditsRemaining);
    this.fraudScore = coerceInt(raw.fraud_score) ?? 0;
    this.valid = coerceBool(raw.valid);
    this.recentAbuse = coerceBool(raw.recent_abuse);
    this.voip = coerceBool(raw.VOIP);
    this.prepaid = coerceBool(raw.prepaid);
    this.risky = coerceBool(raw.risky);
    this.active = coerceBool(raw.active);
    this.doNotCall = coerceBool(raw.do_not_call);
    this.leaked = coerceBool(raw.leaked);
    this.spammer = coerceBool(raw.spammer);
    this.dialingCode = coerceInt(raw.dialing_code);
    this.carrier = coerceString(raw.carrier);
    this.lineType = coerceString(raw.line_type);
    this.country = coerceString(raw.country);
    this.region = coerceString(raw.region);
    this.city = coerceString(raw.city);
    this.timezone = coerceString(raw.timezone);
    this.zipCode = coerceString(raw.zip_code);
    this.activeStatus = coerceString(raw.active_status);
    this.formatted = coerceString(raw.formatted);
    this.localFormat = coerceString(raw.local_format);
  }

  static fromData(data: Raw, creditsRemaining: number | null = null): PhoneResult {
    return new PhoneResult(asRaw(data), creditsRemaining);
  }

  protected defaultFlagOn(): readonly string[] {
    return PhoneResult.DEFAULT_FLAG_ON;
  }
}

export type Result = IpResult | EmailResult | PhoneResult;

export class BatchItem {
  constructor(
    readonly subject: string,
    readonly success: boolean,
    readonly result: Result | null,
    readonly error: string | null,
  ) {}

  isInvalid(): boolean {
    return (
      this.error === "invalid_ip" ||
      this.error === "invalid_email" ||
      this.error === "invalid_phone"
    );
  }

  isInsufficientCredits(): boolean {
    return this.error === "insufficient_credits";
  }

  isUpstreamFailed(): boolean {
    return this.error === "upstream_failed";
  }
}

export class BatchResult {
  constructor(
    readonly items: BatchItem[],
    readonly creditsRemaining: number,
  ) {}

  static fromEnvelope(envelope: Raw, kind: CheckKind): BatchResult {
    const items: BatchItem[] = [];
    const rawItems = envelope.results;
    if (Array.isArray(rawItems)) {
      for (const item of rawItems) {
        if (!isPlainObject(item)) {
          continue;
        }
        const success = coerceBool(item.success) ?? false;
        const data = item.data;
        let result: Result | null = null;
        if (success && isPlainObject(data)) {
          result =
            kind === "ip"
              ? IpResult.fromData(data)
              : kind === "email"
                ? EmailResult.fromData(data)
                : PhoneResult.fromData(data);
        }
        items.push(
          new BatchItem(coerceString(item[kind]) ?? "", success, result, coerceString(item.error)),
        );
      }
    }
    return new BatchResult(items, coerceInt(envelope.credits_remaining) ?? 0);
  }

  successful(): BatchItem[] {
    return this.items.filter((i) => i.success);
  }

  failed(): BatchItem[] {
    return this.items.filter((i) => !i.success);
  }

  hasFailures(): boolean {
    return this.items.some((i) => !i.success);
  }

  get length(): number {
    return this.items.length;
  }

  *[Symbol.iterator](): Iterator<BatchItem> {
    yield* this.items;
  }
}
