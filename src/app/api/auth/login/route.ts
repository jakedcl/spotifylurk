import { createHash, randomBytes } from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { SPOTIFY_SCOPES, requiredEnv } from "@/lib/env";
import { appRedirect } from "@/lib/redirect";
import { OAUTH_STATE_COOKIE, OAUTH_VERIFIER_COOKIE, cookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let clientId = "";
  let redirectUri = "";
  try {
    clientId = requiredEnv("SPOTIFY_CLIENT_ID");
    redirectUri = requiredEnv("SPOTIFY_REDIRECT_URI");
  } catch {
    return appRedirect(request, "/?error=config");
  }
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  const authorize = new URL("https://accounts.spotify.com/authorize");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("scope", SPOTIFY_SCOPES);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("code_challenge", challenge);
  const response = NextResponse.redirect(authorize);
  response.cookies.set(OAUTH_STATE_COOKIE, state, cookieOptions(10 * 60));
  response.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, cookieOptions(10 * 60));
  return response;
}
