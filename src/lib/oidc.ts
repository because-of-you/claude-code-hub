import "server-only";

import { createRemoteJWKSet, type JWTPayload, jwtVerify } from "jose";
import { getEnvConfig } from "@/lib/config/env.schema";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  requiredGroup: string;
}

export function createOidcApplicationUrl(
  path: string,
  options: { redirectUri?: string; requestUrl: string }
): URL {
  return new URL(path, options.redirectUri || options.requestUrl);
}

interface OidcDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

export interface OidcIdentity {
  issuer: string;
  subject: string;
  displayName: string;
  groups: string[];
}

export const OIDC_STATE_COOKIE = "cch-oidc-state";
export const OIDC_NONCE_COOKIE = "cch-oidc-nonce";
export const OIDC_VERIFIER_COOKIE = "cch-oidc-verifier";
export const OIDC_RETURN_COOKIE = "cch-oidc-return";

let discoveryPromise: Promise<OidcDiscovery> | null = null;
let discoveryIssuer = "";
const jwksByUri = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function normalizeIssuer(value: string): string {
  return value.replace(/\/$/, "");
}

export function getOidcConfig(): OidcConfig | null {
  const env = getEnvConfig();
  if (!env.OIDC_ENABLED) return null;

  if (
    !env.OIDC_ISSUER_URL ||
    !env.OIDC_CLIENT_ID ||
    !env.OIDC_CLIENT_SECRET ||
    !env.OIDC_REDIRECT_URI
  ) {
    throw new Error(
      "OIDC is enabled but OIDC_ISSUER_URL, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, or OIDC_REDIRECT_URI is missing"
    );
  }

  return {
    issuer: normalizeIssuer(env.OIDC_ISSUER_URL),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    redirectUri: env.OIDC_REDIRECT_URI,
    requiredGroup: env.OIDC_REQUIRED_GROUP,
  };
}

async function loadDiscovery(config: OidcConfig): Promise<OidcDiscovery> {
  if (!discoveryPromise || discoveryIssuer !== config.issuer) {
    discoveryIssuer = config.issuer;
    discoveryPromise = fetch(`${config.issuer}/.well-known/openid-configuration`, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`OIDC discovery failed with status ${response.status}`);
        }
        return (await response.json()) as Partial<OidcDiscovery>;
      })
      .then((document) => {
        if (
          typeof document.issuer !== "string" ||
          typeof document.authorization_endpoint !== "string" ||
          typeof document.token_endpoint !== "string" ||
          typeof document.jwks_uri !== "string"
        ) {
          throw new Error("OIDC discovery document is incomplete");
        }
        if (normalizeIssuer(document.issuer) !== config.issuer) {
          throw new Error("OIDC discovery issuer does not match OIDC_ISSUER_URL");
        }
        return document as OidcDiscovery;
      })
      .catch((error) => {
        discoveryPromise = null;
        throw error;
      });
  }

  return discoveryPromise;
}

export function createRandomBase64Url(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Buffer.from(bytes).toString("base64url");
}

export async function createPkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

export async function createOidcAuthorizationUrl(options: {
  config: OidcConfig;
  state: string;
  nonce: string;
  codeChallenge: string;
}): Promise<URL> {
  const discovery = await loadDiscovery(options.config);
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("client_id", options.config.clientId);
  url.searchParams.set("redirect_uri", options.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid profile email groups");
  url.searchParams.set("state", options.state);
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

function getDisplayName(payload: JWTPayload): string {
  const claims = payload as JWTPayload & {
    preferred_username?: unknown;
    name?: unknown;
    email?: unknown;
  };
  for (const value of [claims.preferred_username, claims.name, claims.email]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return payload.sub || "OIDC administrator";
}

export async function exchangeOidcCode(options: {
  config: OidcConfig;
  code: string;
  codeVerifier: string;
  nonce: string;
}): Promise<OidcIdentity> {
  const discovery = await loadDiscovery(options.config);
  const credentials = Buffer.from(
    `${options.config.clientId}:${options.config.clientSecret}`,
    "utf8"
  ).toString("base64");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: options.code,
    redirect_uri: options.config.redirectUri,
    client_id: options.config.clientId,
    code_verifier: options.codeVerifier,
  });
  const response = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`OIDC token exchange failed with status ${response.status}`);
  }

  const tokenResponse = (await response.json()) as { id_token?: unknown };
  if (typeof tokenResponse.id_token !== "string") {
    throw new Error("OIDC token response did not include an ID token");
  }

  let jwks = jwksByUri.get(discovery.jwks_uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(discovery.jwks_uri));
    jwksByUri.set(discovery.jwks_uri, jwks);
  }
  const { payload } = await jwtVerify(tokenResponse.id_token, jwks, {
    issuer: options.config.issuer,
    audience: options.config.clientId,
  });
  if (payload.nonce !== options.nonce) {
    throw new Error("OIDC nonce validation failed");
  }
  if (!payload.sub) {
    throw new Error("OIDC ID token is missing the subject claim");
  }

  const rawGroups = (payload as JWTPayload & { groups?: unknown }).groups;
  const groups = Array.isArray(rawGroups)
    ? rawGroups.filter((group): group is string => typeof group === "string")
    : [];

  return {
    issuer: options.config.issuer,
    subject: payload.sub,
    displayName: getDisplayName(payload),
    groups,
  };
}

export function isSafeInternalRedirect(value: string | null | undefined): value is string {
  return Boolean(value?.startsWith("/") && !value.startsWith("//"));
}
