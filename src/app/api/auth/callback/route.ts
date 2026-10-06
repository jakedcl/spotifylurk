import { NextResponse, type NextRequest } from "next/server";
import { getPool } from "@/db";
import { encryptSecret } from "@/lib/crypto";
import { requiredEnv } from "@/lib/env";
import { rateLimitError } from "@/lib/http";
import { enforceAuth } from "@/lib/limits";
import { appRedirect } from "@/lib/redirect";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  SESSION_COOKIE,
  cookieOptions,
  sealSession,
} from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clearOauth(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE, "", cookieOptions(0));
  response.cookies.set(OAUTH_VERIFIER_COOKIE, "", cookieOptions(0));
  return response;
}

export async function GET(request: NextRequest) {
  const limited = await enforceAuth(request);
  if (!limited.ok) return rateLimitError(limited.message, limited.retryAfterSeconds);
  const url = request.nextUrl;
  const fail = (code: string) => clearOauth(appRedirect(request, `/?error=${code}`));
  if (url.searchParams.get("error")) return fail("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expected = request.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = request.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!code || !state || !expected || state !== expected || !verifier) return fail("state");

  let clientId = "";
  let redirectUri = "";
  try {
    clientId = requiredEnv("SPOTIFY_CLIENT_ID");
    redirectUri = requiredEnv("SPOTIFY_REDIRECT_URI");
  } catch {
    return fail("config");
  }

  const tokenResponse = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
    }),
  });
  const token = (await tokenResponse.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!tokenResponse.ok || !token.access_token) return fail("spotify");

  const profileResponse = await fetch("https://api.spotify.com/v1/me", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const profile = (await profileResponse.json().catch(() => ({}))) as {
    id?: string;
    display_name?: string;
    email?: string;
    images?: { url?: string }[];
  };
  if (!profileResponse.ok || !profile.id) return fail("spotify");

  const expiresAt = new Date(Date.now() + (token.expires_in ?? 3600) * 1000);
  const image = profile.images?.find((item) => item.url)?.url ?? null;
  const saved = await getPool().query<{ id: string; refresh_token_enc: string | null }>(
    `INSERT INTO users (
       spotify_id, display_name, email, image_url, refresh_token_enc, access_token_enc, access_token_expires_at, is_dev, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, false, now())
     ON CONFLICT (spotify_id) DO UPDATE SET
       display_name = EXCLUDED.display_name,
       email = EXCLUDED.email,
       image_url = EXCLUDED.image_url,
       refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, users.refresh_token_enc),
       access_token_enc = EXCLUDED.access_token_enc,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       is_dev = false,
       updated_at = now()
     RETURNING id, refresh_token_enc`,
    [
      profile.id,
      profile.display_name || profile.id,
      profile.email ?? null,
      image,
      token.refresh_token ? encryptSecret(token.refresh_token) : null,
      encryptSecret(token.access_token),
      expiresAt,
    ],
  );
  if (!saved.rows[0]?.refresh_token_enc) return fail("spotify");

  const session = sealSession(saved.rows[0].id);
  const response = clearOauth(appRedirect(request, "/library"));
  response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.maxAge));
  return response;
}
