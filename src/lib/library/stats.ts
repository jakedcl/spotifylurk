import { getPool } from "@/db";
import type { LibraryView } from "./types";

export type StatsGroup = "artist" | "release_year" | "decade" | "playlist" | "source";

export type StatsArgs = {
  groupBy: StatsGroup;
  releaseYear?: number;
  releaseYearFrom?: number;
  releaseYearTo?: number;
  decade?: number;
  addedYear?: number;
  addedFrom?: string;
  addedTo?: string;
  sourceScope?: LibraryView;
  explicit?: boolean;
  playlistName?: string;
  limit?: number;
};

export type StatsRow = { key: string; label: string; count: number };

function likePattern(value: string) {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

export async function libraryStats(userId: string, args: StatsArgs): Promise<StatsRow[]> {
  const scope = args.sourceScope ?? "added";
  const values: unknown[] = [];
  const p = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };
  const user = p(userId);
  const conditions = ["s.user_id = " + user, "t.user_id = " + user];

  if (scope === "added") conditions.push(`s.source_type IN ('liked', 'playlist')`);
  if (scope === "album") {
    conditions.push(`s.source_type = 'album'`);
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM track_sources added
      WHERE added.track_id = t.id AND added.source_type IN ('liked', 'playlist')
    )`);
  }
  if (args.groupBy === "playlist") conditions.push(`s.source_type = 'playlist'`);
  if (args.releaseYear !== undefined) conditions.push(`t.release_year = ${p(args.releaseYear)}`);
  if (args.releaseYearFrom !== undefined) conditions.push(`t.release_year >= ${p(args.releaseYearFrom)}`);
  if (args.releaseYearTo !== undefined) conditions.push(`t.release_year <= ${p(args.releaseYearTo)}`);
  if (args.decade !== undefined) {
    conditions.push(`t.release_year >= ${p(args.decade)} AND t.release_year < ${p(args.decade + 10)}`);
  }
  if (args.explicit !== undefined) conditions.push(`t.explicit = ${p(args.explicit)}`);
  if (args.addedFrom) conditions.push(`s.added_at >= ${p(args.addedFrom)}::date`);
  if (args.addedTo) conditions.push(`s.added_at < (${p(args.addedTo)}::date + interval '1 day')`);
  if (args.addedYear !== undefined) {
    conditions.push(
      `s.added_at >= make_date(${p(args.addedYear)}, 1, 1) AND s.added_at < make_date(${p(args.addedYear + 1)}, 1, 1)`,
    );
  }
  if (args.playlistName) {
    conditions.push(`EXISTS (
      SELECT 1 FROM track_sources ps
      JOIN playlists pl ON pl.id = ps.playlist_id
      WHERE ps.track_id = t.id AND pl.name ILIKE ${p(likePattern(args.playlistName))} ESCAPE '\\'
    )`);
  }

  const limit = p(Math.min(Math.max(args.limit ?? 15, 1), 30));
  const where = conditions.join(" AND ");
  let select = "";
  if (args.groupBy === "artist") {
    select = `
      SELECT ar.id::text AS key, ar.name AS label, COUNT(DISTINCT t.id)::int AS count
      FROM track_sources s
      JOIN tracks t ON t.id = s.track_id
      JOIN track_artists ta ON ta.track_id = t.id AND ta.position = 0
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ${where}
      GROUP BY ar.id, ar.name
      ORDER BY count DESC, ar.name ASC
      LIMIT ${limit}`;
  } else if (args.groupBy === "release_year") {
    select = `
      SELECT t.release_year::text AS key, t.release_year::text AS label, COUNT(DISTINCT t.id)::int AS count
      FROM track_sources s
      JOIN tracks t ON t.id = s.track_id
      WHERE ${where} AND t.release_year IS NOT NULL
      GROUP BY t.release_year
      ORDER BY count DESC, t.release_year DESC
      LIMIT ${limit}`;
  } else if (args.groupBy === "decade") {
    select = `
      SELECT ((t.release_year / 10) * 10)::text AS key,
             ((t.release_year / 10) * 10)::text || 's' AS label,
             COUNT(DISTINCT t.id)::int AS count
      FROM track_sources s
      JOIN tracks t ON t.id = s.track_id
      WHERE ${where} AND t.release_year IS NOT NULL
      GROUP BY 1, 2
      ORDER BY count DESC, 1 DESC
      LIMIT ${limit}`;
  } else if (args.groupBy === "playlist") {
    select = `
      SELECT pl.id::text AS key, pl.name AS label, COUNT(DISTINCT t.id)::int AS count
      FROM track_sources s
      JOIN tracks t ON t.id = s.track_id
      JOIN playlists pl ON pl.id = s.playlist_id
      WHERE ${where}
      GROUP BY pl.id, pl.name
      ORDER BY count DESC, pl.name ASC
      LIMIT ${limit}`;
  } else {
    select = `
      SELECT s.source_type AS key, s.source_type AS label, COUNT(DISTINCT t.id)::int AS count
      FROM track_sources s
      JOIN tracks t ON t.id = s.track_id
      WHERE ${where}
      GROUP BY s.source_type
      ORDER BY count DESC, s.source_type ASC
      LIMIT ${limit}`;
  }

  const result = await getPool().query<{ key: string; label: string; count: number }>(select, values);
  return result.rows.map((row) => ({ key: row.key, label: row.label, count: Number(row.count) }));
}
