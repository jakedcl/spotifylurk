import { type NextRequest } from "next/server";
import { appRedirect } from "@/lib/redirect";
import { SESSION_COOKIE, cookieOptions } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const response = appRedirect(request, "/");
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(0));
  return response;
}
