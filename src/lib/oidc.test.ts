import { describe, expect, it } from "vitest";
import { createOidcApplicationUrl } from "@/lib/oidc";

describe("createOidcApplicationUrl", () => {
  it("uses the configured public OIDC origin behind a reverse proxy", () => {
    const url = createOidcApplicationUrl("/dashboard", {
      redirectUri: "https://inner.coding.acitrus.cn/api/auth/oidc/callback",
      requestUrl: "http://0.0.0.0:3000/api/auth/oidc/callback",
    });

    expect(url.toString()).toBe("https://inner.coding.acitrus.cn/dashboard");
  });

  it("falls back to the request URL when OIDC has no public redirect URI", () => {
    const url = createOidcApplicationUrl("/login", {
      requestUrl: "http://localhost:3000/api/auth/oidc/callback",
    });

    expect(url.toString()).toBe("http://localhost:3000/login");
  });
});
