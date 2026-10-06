import { createHmac, timingSafeEqual } from "crypto";
import { requiredEnv } from "./env";

export const SESSION_COOKIE = "pile_session";
export const OAUTH_STATE_COOKIE = "pile_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "pile_oauth_verifier";

type SessionPayload = { uid: string; exp: number };

function secret() {
  return requiredEnv("SESSION_SECRET");
}

export function sealSession(userId: string, maxAgeSec = 60 * 60 * 24 * 30) {
  const payload: SessionPayload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + maxAgeSec,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return { token: `${body}.${sig}`, maxAge: maxAgeSec };
}

export function openSession(token: string | undefined | null): { uid: string } | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (!payload || typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { uid: payload.uid };
  } catch {
    return null;
  }
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}
