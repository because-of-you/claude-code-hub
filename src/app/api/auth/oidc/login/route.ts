import { cookies } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { getEnvConfig } from "@/lib/config/env.schema";
import {
  createOidcAuthorizationUrl,
  createPkceChallenge,
  createRandomBase64Url,
  getOidcConfig,
  isSafeInternalRedirect,
  OIDC_NONCE_COOKIE,
  OIDC_RETURN_COOKIE,
  OIDC_STATE_COOKIE,
  OIDC_VERIFIER_COOKIE,
} from "@/lib/oidc";
import { withAuthResponseHeaders } from "@/lib/security/auth-response-headers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const config = getOidcConfig();
  if (!config) {
    return withAuthResponseHeaders(
      NextResponse.json({ errorCode: "OIDC_DISABLED" }, { status: 404 })
    );
  }

  const state = createRandomBase64Url();
  const nonce = createRandomBase64Url();
  const verifier = createRandomBase64Url(64);
  const codeChallenge = await createPkceChallenge(verifier);
  const returnTo = request.nextUrl.searchParams.get("from");
  const cookieStore = await cookies();
  const cookieOptions = {
    httpOnly: true,
    secure: getEnvConfig().ENABLE_SECURE_COOKIES,
    sameSite: "lax" as const,
    maxAge: 600,
    path: "/api/auth/oidc",
  };
  cookieStore.set(OIDC_STATE_COOKIE, state, cookieOptions);
  cookieStore.set(OIDC_NONCE_COOKIE, nonce, cookieOptions);
  cookieStore.set(OIDC_VERIFIER_COOKIE, verifier, cookieOptions);
  cookieStore.set(
    OIDC_RETURN_COOKIE,
    isSafeInternalRedirect(returnTo) ? returnTo : "/dashboard",
    cookieOptions
  );

  const authorizationUrl = await createOidcAuthorizationUrl({
    config,
    state,
    nonce,
    codeChallenge,
  });
  return withAuthResponseHeaders(NextResponse.redirect(authorizationUrl));
}
