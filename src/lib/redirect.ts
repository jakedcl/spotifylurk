import { NextResponse, type NextRequest } from "next/server";

/** Prefer the browser host. Next's request.url is often http://localhost even when the app is bound to 127.0.0.1. */
export function publicOrigin(headers: Headers, fallback: string) {
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || headers.get("host")?.trim();
  if (!host || /[\s/\\]/.test(host)) return fallback;
  const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto === "http" || forwardedProto === "https" ? forwardedProto : new URL(fallback).protocol.replace(":", "");
  return `${proto}://${host}`;
}

export function appRedirect(request: NextRequest, path: string) {
  const origin = publicOrigin(request.headers, request.nextUrl.origin);
  return NextResponse.redirect(new URL(path, origin));
}
