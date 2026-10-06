import { isUser, jsonError, requireUser } from "@/lib/http";
import { libraryFacets } from "@/lib/library/facets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  try {
    return Response.json(await libraryFacets(user.id));
  } catch (error) {
    console.error(error);
    return jsonError("Could not load filters.", 500);
  }
}
