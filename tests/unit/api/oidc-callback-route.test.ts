import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auditMock,
  cookieDeleteMock,
  cookieGetMock,
  exchangeOidcCodeMock,
  getOidcConfigMock,
  sessionCreateMock,
  setAuthCookieMock,
} = vi.hoisted(() => ({
  auditMock: vi.fn(),
  cookieDeleteMock: vi.fn(),
  cookieGetMock: vi.fn(),
  exchangeOidcCodeMock: vi.fn(),
  getOidcConfigMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  setAuthCookieMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: cookieGetMock, delete: cookieDeleteMock })),
}));
vi.mock("@/lib/auth", () => ({
  getAuthSessionTtlSeconds: vi.fn(() => 3600),
  setAuthCookie: setAuthCookieMock,
  toKeyFingerprint: vi.fn(async () => "sha256:identity"),
}));
vi.mock("@/lib/auth-session-store/redis-session-store", () => ({
  RedisSessionStore: class {
    create = sessionCreateMock;
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/oidc", () => ({
  exchangeOidcCode: exchangeOidcCodeMock,
  getOidcConfig: getOidcConfigMock,
  isSafeInternalRedirect: (value: unknown) =>
    typeof value === "string" && value.startsWith("/") && !value.startsWith("//"),
  OIDC_NONCE_COOKIE: "cch-oidc-nonce",
  OIDC_RETURN_COOKIE: "cch-oidc-return",
  OIDC_STATE_COOKIE: "cch-oidc-state",
  OIDC_VERIFIER_COOKIE: "cch-oidc-verifier",
}));
vi.mock("@/repository/audit-log", () => ({ createAuditLogAsync: auditMock }));

const cookieValues: Record<string, string> = {
  "cch-oidc-state": "expected-state",
  "cch-oidc-nonce": "expected-nonce",
  "cch-oidc-verifier": "verifier",
  "cch-oidc-return": "/dashboard",
};

describe("OIDC callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGetMock.mockImplementation((name: string) =>
      cookieValues[name] ? { value: cookieValues[name] } : undefined
    );
    getOidcConfigMock.mockReturnValue({
      issuer: "https://auth.example.com",
      clientId: "cch",
      clientSecret: "secret",
      redirectUri: "https://hub.example.com/api/auth/oidc/callback",
      requiredGroup: "lldap_admin",
    });
    exchangeOidcCodeMock.mockResolvedValue({
      issuer: "https://auth.example.com",
      subject: "subject-1",
      displayName: "wfy",
      groups: ["lldap_admin"],
    });
    sessionCreateMock.mockResolvedValue({ sessionId: "sid_oidc" });
  });

  it("rejects a callback with invalid state", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/callback/route");
    const response = await GET(
      new NextRequest("https://hub.example.com/api/auth/oidc/callback?state=wrong&code=code")
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("oidc_error=invalid_callback");
    expect(exchangeOidcCodeMock).not.toHaveBeenCalled();
  });

  it("denies identities outside the required group", async () => {
    exchangeOidcCodeMock.mockResolvedValue({
      issuer: "https://auth.example.com",
      subject: "subject-1",
      displayName: "wfy",
      groups: ["developers"],
    });
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/callback/route");
    const response = await GET(
      new NextRequest(
        "https://hub.example.com/api/auth/oidc/callback?state=expected-state&code=code"
      )
    );
    expect(response.headers.get("location")).toContain("oidc_error=group_denied");
    expect(sessionCreateMock).not.toHaveBeenCalled();
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorMessage: "OIDC_REQUIRED_GROUP_MISSING" })
    );
  });

  it("creates an OIDC admin session and redirects internally", async () => {
    const { NextRequest } = await import("next/server");
    const { GET } = await import("@/app/api/auth/oidc/callback/route");
    const response = await GET(
      new NextRequest(
        "https://hub.example.com/api/auth/oidc/callback?state=expected-state&code=code"
      )
    );
    expect(sessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialType: "oidc",
        userId: -1,
        userRole: "admin",
        oidcSubject: "subject-1",
      }),
      3600
    );
    expect(setAuthCookieMock).toHaveBeenCalledWith("sid_oidc");
    expect(response.headers.get("location")).toBe("https://hub.example.com/dashboard");
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, operatorKeyName: "Authelia OIDC" })
    );
    expect(cookieDeleteMock).toHaveBeenCalledTimes(4);
  });
});
