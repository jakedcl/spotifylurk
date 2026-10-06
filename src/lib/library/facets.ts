import { getPool } from "@/db";

export type PlaylistFacet = {
  id: string;
  name: string;
  tracksUnavailable: boolean;
  unavailableReason: string | null;
  trackCount: number;
};

export async function libraryFacets(userId: string) {
  const pool = getPool();
  const playlists = await pool.query<{
    id: string;
    name: string;
    tracks_unavailable: boolean;
    unavailable_reason: string | null;
    track_count: number;
  }>(
    `SELECT p.id, p.name, p.tracks_unavailable, p.unavailable_reason,
            (SELECT count(DISTINCT s.track_id)::int FROM track_sources s WHERE s.playlist_id = p.id) AS track_count
     FROM playlists p
     WHERE p.user_id = $1
     ORDER BY p.name ASC`,
    [userId],
  );
  const years = await pool.query<{ min_year: number | null; max_year: number | null }>(
    `SELECT MIN(release_year)::int AS min_year, MAX(release_year)::int AS max_year
     FROM tracks WHERE user_id = $1`,
    [userId],
  );
  const rows = playlists.rows.map((row) => ({
    id: row.id,
    name: row.name,
    tracksUnavailable: row.tracks_unavailable,
    unavailableReason: row.unavailable_reason,
    trackCount: Number(row.track_count),
  }));
  return {
    playlists: rows,
    yearMin: years.rows[0]?.min_year ?? null,
    yearMax: years.rows[0]?.max_year ?? null,
    unavailablePlaylists: rows.filter((row) => row.tracksUnavailable).length,
  };
}
