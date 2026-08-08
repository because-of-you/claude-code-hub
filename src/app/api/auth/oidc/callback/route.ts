import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getAuthSessionTtlSeconds, setAuthCookie, toKeyFingerprint } from "@/lib/auth";
import { RedisSessionStore } from "@/lib/auth-session-store/redis-session-store";
import { logger } from "@/lib/logger";
import {
  createOidcApplicationUrl,
  exchangeOidcCode,
  getOidcConfig,
  isSafeInternalRedirect,
  OIDC_NONCE_COOKIE,
  OIDC_RETURN_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from "@/lib/oidc";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";
import { createAuditLogAsync } from "@/repository/audit-log";

export const runtime = "nodejs";

const TRANSIENT_COOKIES = [
  OIDC_STATE_COOKIE,
  OIDC_NONCE_COOKIE,
  OIDC_VERIFIER_COOKIE,
  OIDC_RETURN_COOKIE,
];

function loginErrorRedirect(request: NextRequest, code: string): NextResponse {
  const url = createOidcApplicationUrl("/login", {
    redirectUri: getOidcConfig()?.redirectUri,
    requestUrl: request.url,
  });
  url.searchParams.set("oidc_error", code);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const expectedState = cookieStore.get(OIDC_STATE_COOKIE)?.value;
  const nonce = cookieStore.get(OIDC_NONCE_COOKIE)?.value;
  const verifier = cookieStore.get(OIDC_VERIFIER_COOKIE)?.value;
  const returnTo = cookieStore.get(OIDC_RETURN_COOKIE)?.value;
  for (const name of TRANSIENT_COOKIES) cookieStore.delete(name);

  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  if (
    request.nextUrl.searchParams.has("error") ||
    !state ||
    !expectedState ||
    !constantTimeEqual(state, expectedState) ||
    !code ||
    !nonce ||
    !verifier
  ) {
    return loginErrorRedirect(request, "invalid_callback");
  }

  try {
    const config = getOidcConfig();
    if (!config) return loginErrorRedirect(request, "disabled");

    const identity = await exchangeOidcCode({ config, code, codeVerifier: verifier, nonce });
    if (!identity.groups.includes(config.requiredGroup)) {
      createAuditLogAsync({
        actionCategory: "auth",
        actionType: "login.failure",
        operatorUserName: identity.displayName,
        success: false,
        errorMessage: "OIDC_REQUIRED_GROUP_MISSING",
      });
      return loginErrorRedirect(request, "group_denied");
    }

    const sessionStore = new RedisSessionStore();
    const keyFingerprint = await toKeyFingerprint(`${identity.issuer}\0${identity.subject}`);
    const session = await sessionStore.create(
      {
        keyFingerprint,
        credentialType: "oidc",
        userId: -1,
        userRole: "admin",
        oidcIssuer: identity.issuer,
        oidcSubject: identity.subject,
        oidcDisplayName: identity.displayName,
      },
      getAuthSessionTtlSeconds()
    );
    await setAuthCookie(session.sessionId);

    createAuditLogAsync({
      actionCategory: "auth",
      actionType: "login.success",
      targetType: "user",
      targetId: identity.subject,
      targetName: identity.displayName,
      operatorUserId: -1,
      operatorUserName: identity.displayName,
      operatorKeyId: -2,
      operatorKeyName: "Authelia OIDC",
      success: true,
      afterValue: { loginType: "admin", provider: "oidc" },
    });

    const redirectPath = isSafeInternalRedirect(returnTo) ? returnTo : "/dashboard";
    return NextResponse.redirect(
      createOidcApplicationUrl(redirectPath, {
        redirectUri: config.redirectUri,
        requestUrl: request.url,
      })
    );
  } catch (error) {
    logger.error("OIDC callback failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return loginErrorRedirect(request, "authentication_failed");
  }
}
