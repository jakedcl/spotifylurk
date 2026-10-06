import { isUser, jsonError, requireUser } from "@/lib/http";
import { parseFilters } from "@/lib/library/filters";
import { queryLibrary } from "@/lib/library/query";
import { clientForUser } from "@/lib/spotify/account";
import { saveTracksToSpotify } from "@/lib/spotify/save-playlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const user = await requireUser();
  if (!isUser(user)) return user;
  if (!user.hasSpotify) {
    return jsonError("Connect Spotify to save playlists. The sample library stays on this machine.", 400);
  }
  const body = (await request.json().catch(() => null)) as { name?: unknown; query?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) return jsonError("Name the playlist first.");
  const filters = parseFilters(new URLSearchParams(typeof body?.query === "string" ? body.query : ""));
  try {
    const result = await queryLibrary(user.id, filters, { limit: 10_000, offset: 0 });
    if (!result.rows.length) return jsonError("Nothing in this view to save.");
    const saved = await saveTracksToSpotify({
      userId: user.id,
      client: clientForUser(user.id),
      name,
      description: "Saved from a Pile filter.",
      trackIds: result.rows.map((row) => row.id),
    });
    return Response.json({ ...saved, truncated: result.total > result.rows.length, total: result.total });
  } catch (error) {
    console.error(error);
    const message = error instanceof Error ? error.message : "Could not save the playlist.";
    return jsonError(message, 502);
  }
}
