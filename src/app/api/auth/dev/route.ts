import { NextResponse, type NextRequest } from "next/server";
import { getPool } from "@/db";
import { devPreviewEnabled } from "@/lib/env";
import { rateLimitError } from "@/lib/http";
import { enforceAuth } from "@/lib/limits";
import { appRedirect } from "@/lib/redirect";
import { SESSION_COOKIE, cookieOptions, sealSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!devPreviewEnabled()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const limited = await enforceAuth(request);
  if (!limited.ok) return rateLimitError(limited.message, limited.retryAfterSeconds);
  const found = await getPool().query<{ id: string }>(
    `SELECT id FROM users WHERE spotify_id = 'dev-sample' LIMIT 1`,
  );
  if (!found.rows[0]) return appRedirect(request, "/?error=seed");
  const session = sealSession(found.rows[0].id);
  const response = appRedirect(request, "/library");
  response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.maxAge));
  return response;
}
