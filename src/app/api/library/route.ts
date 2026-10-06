import { isUser, jsonError, requireUser } from "@/lib/http";
import { parseFilters, parseLimit, parseOffset } from "@/lib/library/filters";
import { queryLibrary } from "@/lib/library/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireUser();
  if (!isUser(user)) return user;
  const url = new URL(request.url);
  try {
    const result = await queryLibrary(user.id, parseFilters(url.searchParams), {
      limit: parseLimit(url.searchParams.get("limit"), 200, 500),
      offset: parseOffset(url.searchParams.get("offset")),
    });
    return Response.json(result);
  } catch (error) {
    console.error(error);
    return jsonError("Could not load your library.", 500);
  }
}
