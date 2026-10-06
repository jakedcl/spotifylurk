import { getPool } from "@/db";
import { decryptSecret, encryptSecret } from "../crypto";
import { requiredEnv } from "../env";

type TokenRow = {
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  access_token_expires_at: Date | null;
};

async function loadTokens(userId: string) {
  const result = await getPool().query<TokenRow>(
    `SELECT refresh_token_enc, access_token_enc, access_token_expires_at FROM users WHERE id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

export async function refreshAccessToken(userId: string) {
  const row = await loadTokens(userId);
  if (!row?.refresh_token_enc) throw new Error("Spotify is not connected for this account.");
  const refreshToken = decryptSecret(row.refresh_token_enc);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: requiredEnv("SPOTIFY_CLIENT_ID"),
  });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const json = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    refresh_token?: string;
    error?: string;
  };
  if (!response.ok || !json.access_token) {
    throw new Error("Spotify token refresh failed. Sign in again.");
  }
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000);
  await getPool().query(
    `UPDATE users SET
       access_token_enc = $2,
       access_token_expires_at = $3,
       refresh_token_enc = COALESCE($4, refresh_token_enc),
       updated_at = now()
     WHERE id = $1`,
    [
      userId,
      encryptSecret(json.access_token),
      expiresAt,
      json.refresh_token ? encryptSecret(json.refresh_token) : null,
    ],
  );
  return json.access_token;
}

export async function getValidAccessToken(userId: string) {
  const row = await loadTokens(userId);
  if (!row) throw new Error("User not found.");
  if (
    row.access_token_enc &&
    row.access_token_expires_at &&
    row.access_token_expires_at.getTime() > Date.now() + 30_000
  ) {
    return decryptSecret(row.access_token_enc);
  }
  return refreshAccessToken(userId);
}
