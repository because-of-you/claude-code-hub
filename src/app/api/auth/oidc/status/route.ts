import { NextResponse } from "next/server";
import { getOidcConfig } from "@/lib/oidc";
import { withAuthResponseHeaders } from "@/lib/security/auth-response-headers";

export const runtime = "nodejs";

export async function GET() {
  let enabled = false;
  try {
    enabled = getOidcConfig() !== null;
  } catch {
    enabled = false;
  }
  return withAuthResponseHeaders(NextResponse.json({ enabled }));
}
