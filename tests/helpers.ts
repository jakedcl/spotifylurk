import { getPool } from "../src/db";
import type { ParsedTrack } from "../src/lib/spotify/parse";

export async function insertUser(spotifyId: string, name = spotifyId) {
  const result = await getPool().query<{ id: string }>(
    `INSERT INTO users (spotify_id, display_name, is_dev) VALUES ($1, $2, false) RETURNING id`,
    [spotifyId, name],
  );
  return result.rows[0].id;
}

export function fakeTrack(partial: Partial<ParsedTrack> & Pick<ParsedTrack, "spotifyId" | "name">): ParsedTrack {
  const artists = partial.artists ?? [{ spotifyId: "art-default", name: "Default Artist" }];
  return {
    spotifyId: partial.spotifyId,
    uri: partial.uri ?? `spotify:track:${partial.spotifyId}`,
    name: partial.name,
    isrc: partial.isrc ?? null,
    durationMs: partial.durationMs ?? 180000,
    explicit: partial.explicit ?? false,
    popularity: partial.popularity ?? null,
    discNumber: partial.discNumber ?? 1,
    trackNumber: partial.trackNumber ?? 1,
    artists,
    album:
      partial.album === undefined
        ? {
            spotifyId: "alb-default",
            name: "Default Album",
            releaseDate: "2019-01-01",
            releaseYear: 2019,
            albumType: "album",
            imageUrl: null,
            totalTracks: 10,
          }
        : partial.album,
  };
}
