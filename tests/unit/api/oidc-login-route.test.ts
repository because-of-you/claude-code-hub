import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  cookieSetMock,
  createOidcAuthorizationUrlMock,
  createPkceChallengeMock,
  createRandomBase64UrlMock,
  getEnvConfigMock,
  getOidcConfigMock,
  resolveOidcRedirectUriMock,
} = vi.hoisted(() => ({
  cookieSetMock: vi.fn(),
  createOidcAuthorizationUrlMock: vi.fn(),
  createPkceChallengeMock: vi.fn(),
  createRandomBase64UrlMock: vi.fn(),
  getEnvConfigMock: vi.fn(),
  getOidcConfigMock: vi.fn(),
  resolveOidcRedirectUriMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ set: cookieSetMock })),
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: getEnvConfigMock,
}));
vi.mock("@/lib/security/auth-response-headers", () => ({
  withAuthResponseHeaders: (response: unknown) => response,
}));
vi.mock("@/lib/oidc", () => ({
  createOidcAuthorizationUrl: createOidcAuthorizationUrlMock,
  createPkceChallenge: createPkceChallengeMock,
  createRandomBase64Url: createRandomBase64UrlMock,
  getOidcConfig: getOidcConfigMock,
  isSafeInternalRedirect: (value: unknown) =>
    typeof value === "string" && value.startsWith("/") && !value.startsWith("//"),
  resolveOidcRedirectUri: resolveOidcRedirectUriMock,
  resolveRequestHost: () => "hub.example.com",
  OIDC_NONCE_COOKIE: "cch-oidc-nonce",
  OIDC_RETURN_COOKIE: "cch-oidc-return",
  OIDC_STATE_COOKIE: "cch-oidc-state",
  OIDC_VERIFIER_COOKIE: "cch-oidc-verifier",
}));

describe("OIDC login route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvConfigMock.mockReturnValue({ ENABLE_SECURE_COOKIES: true });
    getOidcConfigMock.mockReturnValue({
      issuer: "https://auth.example.com",
      clientId: "cch",
      clientSecret: "secret",
      redirectUri: "https://hub.example.com/api/auth/oidc/callback",
      allowedRedirectUris: [
        "https://hub.example.com/api/auth/oidc/callback",
        "https://inner.hub.example.com/api/auth/oidc/callback",
      ],
      requiredGroup: "lldap_admin",
    });
    resolveOidcRedirectUriMock.mockReturnValue("https://hub.example.com/api/auth/oidc/callback");
    createRandomBase64UrlMock.mockReturnValue("random-value");
    createPkceChallengeMock.mockResolvedValue("code-challenge");
    createOidcAuthorizationUrlMock.mockResolvedValue(
      new URL("https://auth.example.com/api/oidc/authorization?state=random-value")
    );
  });

  it("returns 404 when OIDC is disabled", async () => {
    getOidcConfigMock.mockReturnValue(null);
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/login/route");
    const response = await GET(new NextRequest("https://hub.example.com/api/auth/oidc/login"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ errorCode: "OIDC_DISABLED" });
  });

  it("falls back to the configured callback for an unrecognized host", async () => {
    resolveOidcRedirectUriMock.mockReturnValue(null);
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/login/route");
    const response = await GET(
      new NextRequest("https://hub.example.com/api/auth/oidc/login?from=/dashboard")
    );
    expect(response.status).toBe(307);
    expect(createOidcAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: "https://hub.example.com/api/auth/oidc/callback",
      })
    );
    expect(cookieSetMock).toHaveBeenCalled();
  });

  it("starts PKCE login with the callback URL of the request host", async () => {
    resolveOidcRedirectUriMock.mockReturnValue(
      "https://inner.hub.example.com/api/auth/oidc/callback"
    );
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/login/route");
    const response = await GET(
      new NextRequest("https://inner.hub.example.com/api/auth/oidc/login?from=/dashboard")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://auth.example.com/api/oidc/authorization?state=random-value"
    );
    expect(createOidcAuthorizationUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        redirectUri: "https://inner.hub.example.com/api/auth/oidc/callback",
        codeChallenge: "code-challenge",
      })
    );
    expect(cookieSetMock).toHaveBeenCalledWith(
      "cch-oidc-state",
      "random-value",
      expect.any(Object)
    );
    expect(cookieSetMock).toHaveBeenCalledWith("cch-oidc-return", "/dashboard", expect.any(Object));
  });

  it("stores a sanitized return path", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/login/route");
    await GET(
      new NextRequest(
        "https://hub.example.com/api/auth/oidc/login?from=" +
          encodeURIComponent("//attacker.example/steal")
      )
    );
    expect(cookieSetMock).toHaveBeenCalledWith("cch-oidc-return", "/dashboard", expect.any(Object));
  });
});
