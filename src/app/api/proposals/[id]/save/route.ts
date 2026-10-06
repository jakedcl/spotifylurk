import { getPool } from "@/db";
import { isUser, jsonError, requireUser } from "@/lib/http";
import { clientForUser } from "@/lib/spotify/account";
import { saveTracksToSpotify } from "@/lib/spotify/save-playlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  if (!isUser(user)) return user;
  if (!user.hasSpotify) {
    return jsonError("Connect Spotify to save playlists. The sample library stays on this machine.", 400);
  }
  const { id } = await context.params;
  const found = await getPool().query<{
    id: string;
    name: string;
    description: string | null;
    track_ids: string[];
    status: string;
  }>(`SELECT id, name, description, track_ids, status FROM playlist_proposals WHERE id = $1 AND user_id = $2`, [
    id,
    user.id,
  ]);
  const proposal = found.rows[0];
  if (!proposal) return jsonError("That draft is gone.", 404);
  if (proposal.status === "saved") return jsonError("That playlist was already saved.", 409);
  try {
    const saved = await saveTracksToSpotify({
      userId: user.id,
      client: clientForUser(user.id),
      name: proposal.name,
      description: proposal.description,
      trackIds: proposal.track_ids,
    });
    await getPool().query(
      `UPDATE playlist_proposals
       SET status = 'saved', spotify_playlist_id = $3, error = NULL, saved_at = now()
       WHERE id = $1 AND user_id = $2`,
      [proposal.id, user.id, saved.spotifyPlaylistId],
    );
    return Response.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the playlist.";
    console.error(error);
    await getPool().query(
      `UPDATE playlist_proposals SET status = 'failed', error = $3 WHERE id = $1 AND user_id = $2`,
      [proposal.id, user.id, message],
    );
    return jsonError(message, 502);
  }
}
