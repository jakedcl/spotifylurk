import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./users";

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function rateLimitError(message: string, retryAfterSeconds: number) {
  return NextResponse.json(
    { error: message },
    {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(1, retryAfterSeconds)),
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function requireUser(): Promise<CurrentUser | NextResponse> {
  try {
    const user = await getCurrentUser();
    if (!user) return jsonError("Sign in required.", 401);
    return user;
  } catch (error) {
    console.error(error);
    return jsonError("Could not read your session.", 500);
  }
}

export function isUser(value: CurrentUser | NextResponse): value is CurrentUser {
  return !(value instanceof NextResponse);
}
