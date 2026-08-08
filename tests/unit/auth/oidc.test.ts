import { beforeEach, describe, expect, it, vi } from "vitest";

const { createRemoteJWKSetMock, getEnvConfigMock, jwtVerifyMock } = vi.hoisted(() => ({
  createRemoteJWKSetMock: vi.fn(() => "remote-jwks"),
  getEnvConfigMock: vi.fn(),
  jwtVerifyMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/config/env.schema", () => ({ getEnvConfig: getEnvConfigMock }));
vi.mock("jose", () => ({
  createRemoteJWKSet: createRemoteJWKSetMock,
  jwtVerify: jwtVerifyMock,
}));

const enabledConfig = {
  OIDC_ENABLED: true,
  OIDC_ISSUER_URL: "https://auth.example.com/",
  OIDC_CLIENT_ID: "cch-client",
  OIDC_CLIENT_SECRET: "client-secret",
  OIDC_REDIRECT_URI: "https://hub.example.com/api/auth/oidc/callback",
  OIDC_REQUIRED_GROUP: "lldap_admin",
};

describe("OIDC helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getEnvConfigMock.mockReturnValue(enabledConfig);
  });

  it("returns null when OIDC is disabled", async () => {
    getEnvConfigMock.mockReturnValue({ ...enabledConfig, OIDC_ENABLED: false });
    const { getOidcConfig } = await import("@/lib/oidc");
    expect(getOidcConfig()).toBeNull();
  });

  it("requires all confidential client settings", async () => {
    getEnvConfigMock.mockReturnValue({ ...enabledConfig, OIDC_CLIENT_SECRET: undefined });
    const { getOidcConfig } = await import("@/lib/oidc");
    expect(() => getOidcConfig()).toThrow("OIDC is enabled");
  });

  it("normalizes issuer and creates an authorization request with PKCE", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/api/oidc/authorization",
          token_endpoint: "https://auth.example.com/api/oidc/token",
          jwks_uri: "https://auth.example.com/jwks.json",
        })
      )
    );
    const { createOidcAuthorizationUrl, getOidcConfig } = await import("@/lib/oidc");
    const config = getOidcConfig();
    expect(config?.issuer).toBe("https://auth.example.com");
    const url = await createOidcAuthorizationUrl({
      config: config!,
      state: "state-value",
      nonce: "nonce-value",
      codeChallenge: "challenge-value",
    });
    expect(url.origin + url.pathname).toBe("https://auth.example.com/api/oidc/authorization");
    expect(url.searchParams.get("scope")).toBe("openid profile email groups");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("nonce")).toBe("nonce-value");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("exchanges and validates an ID token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/api/oidc/authorization",
          token_endpoint: "https://auth.example.com/api/oidc/token",
          jwks_uri: "https://auth.example.com/jwks.json",
        })
      )
      .mockResolvedValueOnce(Response.json({ id_token: "signed-token" }));
    vi.stubGlobal("fetch", fetchMock);
    jwtVerifyMock.mockResolvedValue({
      payload: {
        sub: "user-subject",
        nonce: "expected-nonce",
        preferred_username: "wfy",
        groups: ["lldap_admin", "developers", 123],
      },
    });

    const { exchangeOidcCode, getOidcConfig } = await import("@/lib/oidc");
    const identity = await exchangeOidcCode({
      config: getOidcConfig()!,
      code: "authorization-code",
      codeVerifier: "verifier",
      nonce: "expected-nonce",
    });

    expect(identity).toEqual({
      issuer: "https://auth.example.com",
      subject: "user-subject",
      displayName: "wfy",
      groups: ["lldap_admin", "developers"],
    });
    expect(jwtVerifyMock).toHaveBeenCalledWith(
      "signed-token",
      "remote-jwks",
      expect.objectContaining({ issuer: "https://auth.example.com", audience: "cch-client" })
    );
    const tokenRequest = fetchMock.mock.calls[1];
    expect(tokenRequest?.[1]?.headers).toMatchObject({
      Authorization: `Basic ${Buffer.from("cch-client:client-secret").toString("base64")}`,
    });
  });

  it("rejects a mismatched nonce", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({
            issuer: "https://auth.example.com",
            authorization_endpoint: "https://auth.example.com/api/oidc/authorization",
            token_endpoint: "https://auth.example.com/api/oidc/token",
            jwks_uri: "https://auth.example.com/jwks.json",
          })
        )
        .mockResolvedValueOnce(Response.json({ id_token: "signed-token" }))
    );
    jwtVerifyMock.mockResolvedValue({ payload: { sub: "subject", nonce: "other" } });
    const { exchangeOidcCode, getOidcConfig } = await import("@/lib/oidc");
    await expect(
      exchangeOidcCode({
        config: getOidcConfig()!,
        code: "code",
        codeVerifier: "verifier",
        nonce: "expected",
      })
    ).rejects.toThrow("nonce validation failed");
  });

  it("only accepts relative internal redirect paths", async () => {
    const { isSafeInternalRedirect } = await import("@/lib/oidc");
    expect(isSafeInternalRedirect("/dashboard")).toBe(true);
    expect(isSafeInternalRedirect("//attacker.example")).toBe(false);
    expect(isSafeInternalRedirect("https://attacker.example")).toBe(false);
    expect(isSafeInternalRedirect(null)).toBe(false);
  });
});
