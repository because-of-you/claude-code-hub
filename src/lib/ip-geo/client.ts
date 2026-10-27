import { isIP } from "node:net";
import { getEnvConfig } from "@/lib/config/env.schema";
import { isPrivateIp } from "@/lib/ip/private-ip";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import type { IpGeoLookupResponse, IpGeoLookupResult } from "@/types/ip-geo";

const CACHE_PREFIX = "ipgeo:v1:";
const NEGATIVE_TTL_SECONDS = 60;

interface CachedOk {
  kind: "ok";
  data: IpGeoLookupResult;
}

interface CachedError {
  kind: "error";
  error: string;
}

type CachedEntry = CachedOk | CachedError;

function cacheKey(ip: string, lang: string): string {
  return `${CACHE_PREFIX}${ip}:${lang}`;
}

async function readCache(key: string): Promise<CachedEntry | null> {
  try {
    const redis = getRedisClient();
    if (!redis) return null;
    const raw = await redis.get(key);
    if (!raw) return null;
    return JSON.parse(raw) as CachedEntry;
  } catch (error) {
    logger.debug("[IpGeo] cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function writeCache(key: string, entry: CachedEntry, ttlSeconds: number): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) return;
    await redis.set(key, JSON.stringify(entry), "EX", ttlSeconds);
  } catch (error) {
    logger.debug("[IpGeo] cache write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function isValidLookupResult(data: unknown): data is IpGeoLookupResult {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  if (typeof d.ip !== "string" || d.ip.length === 0) return false;

  // Required UI-critical subtree:
  //   ip, location.country.{code,name}, timezone.id, connection (object).
  // Individual fields inside `connection` (asn / route / organization /
  // domain / ...) may legitimately be null — CGN (100.64/10), Tailscale,
  // and bogon ranges have no advertised ASN or route. We intentionally
  // accept those payloads so the UI can surface what info is available
  // instead of negative-caching every private-ish IP.
  const location = d.location as Record<string, unknown> | undefined;
  if (!location || typeof location !== "object") return false;
  const country = location.country as Record<string, unknown> | undefined;
  if (!country || typeof country !== "object") return false;
  if (typeof country.code !== "string" || typeof country.name !== "string") return false;

  // `country.flag.emoji` is dereferenced directly by the dialog, so if
  // upstream drifts into omitting the flag object we'd crash at render
  // time. Reject here instead, falling into the negative-cache path. Note
  // that `flag.svg` and `flag.png` are still allowed to be null — only the
  // emoji field itself is a hard requirement for the fallback unknown-country
  // payload shape.
  const flag = country.flag as Record<string, unknown> | undefined;
  if (!flag || typeof flag !== "object") return false;
  if (typeof flag.emoji !== "string") return false;

  const timezone = d.timezone as Record<string, unknown> | undefined;
  if (!timezone || typeof timezone !== "object") return false;
  if (typeof timezone.id !== "string") return false;

  const connection = d.connection as Record<string, unknown> | undefined;
  if (!connection || typeof connection !== "object") return false;
  // Accept asn = number | null (null for CGN / bogon)
  if (connection.asn !== null && typeof connection.asn !== "number") return false;

  return true;
}

interface IpSbLookupPayload {
  ip?: unknown;
  country_code?: unknown;
  country?: unknown;
  continent_code?: unknown;
  region?: unknown;
  city?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  timezone?: unknown;
  offset?: unknown;
  organization?: unknown;
  isp?: unknown;
  asn_organization?: unknown;
  asn?: unknown;
}

const CONTINENT_NAMES: Record<string, string> = {
  AF: "Africa",
  AN: "Antarctica",
  AS: "Asia",
  EU: "Europe",
  NA: "North America",
  OC: "Oceania",
  SA: "South America",
};

function countryFlagEmoji(countryCode: string): string {
  if (!/^[A-Z]{2}$/.test(countryCode) || countryCode === "ZZ") {
    return "\u{1f1ff}\u{1f1ff}";
  }
  return String.fromCodePoint(
    ...countryCode.split("").map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)
  );
}

function formatUtcOffset(offset: unknown): string {
  if (typeof offset !== "number" || !Number.isFinite(offset)) return "+00:00";
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(Math.trunc(offset));
  const hours = String(Math.floor(absolute / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

function normalizeIpSbResult(ip: string, payload: unknown): IpGeoLookupResult | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as IpSbLookupPayload;
  const countryCode =
    typeof data.country_code === "string" && /^[A-Za-z]{2}$/.test(data.country_code)
      ? data.country_code.toUpperCase()
      : "ZZ";
  const countryName =
    typeof data.country === "string" && data.country.trim() ? data.country : "Unknown";
  const continentCode =
    typeof data.continent_code === "string" && data.continent_code.trim()
      ? data.continent_code.toUpperCase()
      : "ZZ";
  const organization =
    [data.asn_organization, data.organization, data.isp].find(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    ) ?? null;
  const asn = typeof data.asn === "number" && Number.isFinite(data.asn) ? data.asn : null;
  const timezone =
    typeof data.timezone === "string" && data.timezone.trim() ? data.timezone : "UTC";
  const latitude =
    typeof data.latitude === "number" && Number.isFinite(data.latitude) ? data.latitude : 0;
  const longitude =
    typeof data.longitude === "number" && Number.isFinite(data.longitude) ? data.longitude : 0;
  const region = typeof data.region === "string" && data.region.trim() ? data.region : null;
  const city = typeof data.city === "string" && data.city.trim() ? data.city : null;

  return {
    ip,
    version: isIP(ip) === 6 ? "ipv6" : "ipv4",
    hostname: null,
    location: {
      continent: { code: continentCode, name: CONTINENT_NAMES[continentCode] ?? "Unknown" },
      country: {
        code: countryCode,
        code3: "",
        name: countryName,
        name_native: countryName,
        capital: null,
        calling_code: "",
        tld: "",
        area_km2: 0,
        population: 0,
        borders: [],
        is_eu_member: false,
        flag: {
          emoji: countryFlagEmoji(countryCode),
          unicode: "",
          svg: null,
          png: null,
        },
        languages: [],
        currencies: [],
      },
      region: region ? { code: "", name: region, type: "region" } : null,
      city,
      postal_code: null,
      coordinates: { latitude, longitude, accuracy_radius_km: null },
    },
    timezone: {
      id: timezone,
      name: timezone,
      abbreviation: timezone.split("/").at(-1) ?? timezone,
      utc_offset: formatUtcOffset(data.offset),
      utc_offset_seconds:
        typeof data.offset === "number" && Number.isFinite(data.offset) ? data.offset : 0,
      is_dst: false,
      current_time: new Date().toISOString(),
    },
    connection: {
      asn,
      handle: null,
      organization,
      domain: null,
      route: null,
      rir: "UNKNOWN",
      type: "unknown",
      subtype: null,
      scope: "public",
      is_anycast: false,
    },
    company: { name: organization, domain: null, type: "unknown" },
    carrier: null,
    hosting: null,
    privacy: {
      is_proxy: false,
      is_vpn: false,
      is_tor: false,
      is_tor_exit: false,
      is_relay: false,
      is_anonymous: false,
    },
    threat: {
      is_abuser: false,
      is_attacker: false,
      is_crawler: false,
      is_threat: false,
      score: 0,
      risk_level: "none",
      blocklists: [],
    },
    abuse: null,
  };
}

function isIpSbApi(base: string): boolean {
  try {
    const hostname = new URL(base).hostname.toLowerCase();
    return hostname === "ip.sb" || hostname.endsWith(".ip.sb");
  } catch {
    return false;
  }
}

async function fetchFromIpSb(
  base: string,
  ip: string,
  timeoutMs: number
): Promise<IpGeoLookupResult | { error: string }> {
  const url = `${base.replace(/\/+$/, "")}/geoip/${encodeURIComponent(ip)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (!response.ok) return { error: `fallback upstream status ${response.status}` };

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      return { error: "fallback upstream invalid json" };
    }

    const result = normalizeIpSbResult(ip, payload);
    return result ? result : { error: "fallback upstream returned unexpected shape" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromUpstream(
  ip: string,
  lang: string
): Promise<IpGeoLookupResult | { error: string }> {
  const env = getEnvConfig();
  const base = env.IP_GEO_API_URL.replace(/\/+$/, "");

  if (isIpSbApi(base)) {
    return fetchFromIpSb(base, ip, env.IP_GEO_TIMEOUT_MS);
  }

  const url = `${base}/v1/ip2location/${encodeURIComponent(ip)}?lang=${encodeURIComponent(lang)}`;

  const fallback = async (): Promise<IpGeoLookupResult | { error: string }> => {
    const result = await fetchFromIpSb(env.IP_GEO_FALLBACK_API_URL, ip, env.IP_GEO_TIMEOUT_MS);
    if (!("error" in result)) {
      logger.warn("[IpGeo] using fallback provider", { ip, lang });
    }
    return result;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.IP_GEO_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (env.IP_GEO_API_TOKEN) headers.authorization = `Bearer ${env.IP_GEO_API_TOKEN}`;

    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });

    const responseText = await response.text();

    if (!response.ok) {
      logger.error("[IpGeo] upstream request failed", {
        ip,
        lang,
        url,
        status: response.status,
        bodySnippet: responseText.slice(0, 300),
      });
      const fallbackResult = await fallback();
      if (!("error" in fallbackResult)) return fallbackResult;
      return { error: `upstream status ${response.status}; ${fallbackResult.error}` };
    }

    let data: IpGeoLookupResult;
    try {
      data = JSON.parse(responseText) as IpGeoLookupResult;
    } catch (error) {
      logger.error("[IpGeo] upstream returned invalid json", {
        ip,
        lang,
        url,
        error: error instanceof Error ? error.message : String(error),
        bodySnippet: responseText.slice(0, 300),
      });
      const fallbackResult = await fallback();
      if (!("error" in fallbackResult)) return fallbackResult;
      return { error: `upstream invalid json; ${fallbackResult.error}` };
    }

    // Validate the UI-critical subtree before we cache this for an hour.
    // If upstream drifts or returns a partial payload, fail here rather than
    // letting the dashboard blow up at `data.location.country.flag.emoji`.
    if (!isValidLookupResult(data)) {
      logger.error("[IpGeo] upstream returned unexpected shape", {
        ip,
        lang,
        url,
        bodySnippet: responseText.slice(0, 300),
      });
      const fallbackResult = await fallback();
      if (!("error" in fallbackResult)) return fallbackResult;
      return { error: `upstream returned unexpected shape; ${fallbackResult.error}` };
    }
    return data;
  } catch (error) {
    logger.error("[IpGeo] upstream request threw", {
      ip,
      lang,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallbackResult = await fallback();
    if (!("error" in fallbackResult)) return fallbackResult;
    return {
      error: `${error instanceof Error ? error.message : String(error)}; ${fallbackResult.error}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface LookupIpOptions {
  lang?: string;
  /** When true, skip the cache entirely (still writes to cache on success). */
  bypassCache?: boolean;
}

/**
 * Resolve geolocation + network metadata for an IP.
 *
 * - Short-circuits private / loopback / link-local IPs without hitting upstream.
 * - Caches both successful and negative results in Redis (negative = 60s, success = configurable).
 * - Never throws; returns `{ status: "error" }` on failure so callers can render a graceful UI.
 */
export async function lookupIp(
  ip: string,
  options: LookupIpOptions = {}
): Promise<IpGeoLookupResponse> {
  const trimmedIp = ip.trim();

  if (!isIP(trimmedIp)) {
    return { status: "error", error: "invalid ip" };
  }

  if (isPrivateIp(trimmedIp)) {
    return { status: "private", data: { ip: trimmedIp, kind: "private" } };
  }

  const env = getEnvConfig();
  const lang = options.lang ?? "en";
  const key = cacheKey(trimmedIp, lang);

  if (!options.bypassCache) {
    const cached = await readCache(key);
    if (cached) {
      return cached.kind === "ok"
        ? { status: "ok", data: cached.data }
        : { status: "error", error: cached.error };
    }
  }

  const upstream = await fetchFromUpstream(trimmedIp, lang);

  if ("error" in upstream) {
    logger.warn("[IpGeo] lookup failed", {
      ip: trimmedIp,
      lang,
      error: upstream.error,
      bypassCache: !!options.bypassCache,
    });
    await writeCache(key, { kind: "error", error: upstream.error }, NEGATIVE_TTL_SECONDS);
    return { status: "error", error: upstream.error };
  }

  await writeCache(key, { kind: "ok", data: upstream }, env.IP_GEO_CACHE_TTL_SECONDS);
  return { status: "ok", data: upstream };
}
