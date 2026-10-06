import { isUser, jsonError, requireUser } from "@/lib/http";
import { parseFilters } from "@/lib/library/filters";
import { queryLibrary, toCsv } from "@/lib/library/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await requireUser();
  if (!isUser(user)) return user;
  const url = new URL(request.url);
  try {
    const result = await queryLibrary(user.id, parseFilters(url.searchParams), { limit: 50_000, offset: 0 });
    return new Response(toCsv(result.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": "attachment; filename=\"pile.csv\"",
      },
    });
  } catch (error) {
    console.error(error);
    return jsonError("Could not export your library.", 500);
  }
}
