import { getPool } from "@/db";
import type { SpotifyClient } from "./client";

function chunks<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export async function saveTracksToSpotify(opts: {
  userId: string;
  client: SpotifyClient;
  name: string;
  description?: string | null;
  trackIds: string[];
}) {
  const name = opts.name.trim().slice(0, 100);
  if (!name) throw new Error("Name the playlist first.");
  const uniqueIds = [...new Set(opts.trackIds)].slice(0, 10_000);
  if (!uniqueIds.length) throw new Error("Nothing to save.");
  const found = await getPool().query<{ id: string; uri: string }>(
    `SELECT id, uri FROM tracks WHERE user_id = $1 AND id = ANY($2::uuid[])`,
    [opts.userId, uniqueIds],
  );
  const byId = new Map(found.rows.map((row) => [row.id, row.uri]));
  const missing = uniqueIds.filter((id) => !byId.has(id));
  if (missing.length) throw new Error("Some of those songs are not in your library.");
  const uris = uniqueIds.map((id) => byId.get(id)!);
  const description = (opts.description ?? "Saved from Pile.").slice(0, 300);
  const created = await opts.client.post<{ id: string }>("/v1/me/playlists", {
    name,
    description,
    public: false,
  });
  if (!created?.id) throw new Error("Spotify did not return a playlist id.");
  try {
    for (const group of chunks(uris, 100)) {
      await opts.client.post(`/v1/playlists/${created.id}/items`, { uris: group });
    }
  } catch (error) {
    console.error(error);
    throw new Error(`Spotify created “${name}” but adding songs failed. Open it on Spotify and try again.`);
  }

  const playlist = await getPool().query<{ id: string }>(
    `INSERT INTO playlists (user_id, spotify_id, name, description, is_public, track_count, tracks_unavailable, updated_at)
     VALUES ($1, $2, $3, $4, false, $5, false, now())
     ON CONFLICT (user_id, spotify_id) DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       track_count = EXCLUDED.track_count,
       tracks_unavailable = false,
       unavailable_reason = NULL,
       updated_at = now()
     RETURNING id`,
    [opts.userId, created.id, name, description, uris.length],
  );
  const playlistId = playlist.rows[0].id;
  await getPool().query(
    `INSERT INTO track_sources (user_id, track_id, source_type, playlist_id, added_at)
     SELECT $1, x.id, 'playlist', $2, now()
     FROM json_to_recordset($3::json) AS x(id uuid)
     ON CONFLICT ON CONSTRAINT track_sources_identity DO NOTHING`,
    [opts.userId, playlistId, JSON.stringify(uniqueIds.map((id) => ({ id })))],
  );

  return {
    spotifyPlaylistId: created.id,
    url: `https://open.spotify.com/playlist/${created.id}`,
    trackCount: uris.length,
    name,
  };
}
