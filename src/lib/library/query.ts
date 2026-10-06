import { getPool } from "@/db";
import type { LibraryFilters, LibraryQueryResult, LibraryRow, LibrarySource, LibraryArtist } from "./types";

const SORTS = {
  added: "added_at",
  name: "name",
  artist: "artist_sort",
  album: "album_name",
  year: "release_year",
} as const;

function likePattern(value: string) {
  return `%${value.toLowerCase().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

type Row = {
  id: string;
  name: string;
  uri: string;
  release_year: number | null;
  explicit: boolean;
  duration_ms: number;
  album_name: string | null;
  album_image: string | null;
  added_at: Date | string | null;
  total_count: number | string;
  sources: LibrarySource[] | null;
  artists: LibraryArtist[] | null;
};

export async function queryLibrary(
  userId: string,
  filters: LibraryFilters,
  paging: { limit: number; offset: number },
): Promise<LibraryQueryResult> {
  if (filters.genre) {
    const genres = await getPool().query(
      `SELECT 1 FROM artists WHERE user_id = $1 AND cardinality(genres) > 0 LIMIT 1`,
      [userId],
    );
    if (!genres.rowCount) {
      return {
        total: 0,
        rows: [],
        warning: "No artist genre data is loaded yet. Genre and mood filters cannot be applied.",
      };
    }
  }

  const values: unknown[] = [];
  const p = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  const view = filters.view;
  const where: string[] = [
    `(
      ${p(view)} = 'all'
      OR (${p(view)} = 'added' AND has_added)
      OR (${p(view)} = 'album' AND NOT has_added AND has_album)
    )`,
  ];

  if (filters.q) where.push(`search_text ILIKE ${p(likePattern(filters.q))} ESCAPE '\\'`);
  if (filters.artist) {
    where.push(`EXISTS (
      SELECT 1 FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = base.id AND ar.name ILIKE ${p(likePattern(filters.artist))} ESCAPE '\\'
    )`);
  }
  if (filters.yearFrom !== null) where.push(`release_year >= ${p(filters.yearFrom)}`);
  if (filters.yearTo !== null) where.push(`release_year <= ${p(filters.yearTo)}`);
  if (filters.decade !== null) {
    where.push(`release_year >= ${p(filters.decade)} AND release_year < ${p(filters.decade + 10)}`);
  }
  if (filters.explicit !== null) where.push(`explicit = ${p(filters.explicit)}`);
  if (filters.source) {
    where.push(`EXISTS (
      SELECT 1 FROM track_sources s
      WHERE s.track_id = base.id AND s.user_id = ${p(userId)} AND s.source_type = ${p(filters.source)}
    )`);
  }
  if (filters.playlistId) {
    where.push(`EXISTS (
      SELECT 1 FROM track_sources s
      WHERE s.track_id = base.id AND s.playlist_id = ${p(filters.playlistId)}
    )`);
  }
  if (filters.playlistName) {
    where.push(`EXISTS (
      SELECT 1 FROM track_sources s
      JOIN playlists pl ON pl.id = s.playlist_id
      WHERE s.track_id = base.id AND pl.name ILIKE ${p(likePattern(filters.playlistName))} ESCAPE '\\'
    )`);
  }
  if (filters.addedFrom) where.push(`added_at >= ${p(filters.addedFrom)}::date`);
  if (filters.addedTo) where.push(`added_at < (${p(filters.addedTo)}::date + interval '1 day')`);
  if (filters.addedYear !== null) {
    where.push(
      `added_at >= make_date(${p(filters.addedYear)}, 1, 1) AND added_at < make_date(${p(filters.addedYear + 1)}, 1, 1)`,
    );
  }
  if (filters.genre) {
    where.push(`EXISTS (
      SELECT 1
      FROM track_artists ta
      JOIN artists ar ON ar.id = ta.artist_id
      WHERE ta.track_id = base.id
        AND EXISTS (
          SELECT 1 FROM unnest(ar.genres) AS g
          WHERE g ILIKE ${p(likePattern(filters.genre))} ESCAPE '\\'
        )
    )`);
  }

  const sort = SORTS[filters.sort] ?? "added_at";
  const dir = filters.dir === "asc" ? "ASC" : "DESC";
  const userParam = p(userId);
  const addedView = p(view);
  const addedViewAgain = p(view);
  const allView = p(view);
  const limit = p(paging.limit);
  const offset = p(paging.offset);

  const sql = `
    WITH base AS (
      SELECT
        t.id,
        t.name,
        t.uri,
        t.release_year,
        t.explicit,
        t.duration_ms,
        t.search_text,
        al.name AS album_name,
        al.image_url AS album_image,
        (
          SELECT string_agg(ar.name, ', ' ORDER BY ta.position)
          FROM track_artists ta
          JOIN artists ar ON ar.id = ta.artist_id
          WHERE ta.track_id = t.id
        ) AS artist_sort,
        (
          SELECT MIN(s.added_at)
          FROM track_sources s
          WHERE s.track_id = t.id
            AND (
              ${allView} = 'all'
              OR (${addedView} = 'album' AND s.source_type = 'album')
              OR (${addedViewAgain} = 'added' AND s.source_type IN ('liked', 'playlist'))
            )
        ) AS added_at,
        EXISTS (
          SELECT 1 FROM track_sources s
          WHERE s.track_id = t.id AND s.source_type IN ('liked', 'playlist')
        ) AS has_added,
        EXISTS (
          SELECT 1 FROM track_sources s
          WHERE s.track_id = t.id AND s.source_type = 'album'
        ) AS has_album
      FROM tracks t
      LEFT JOIN albums al ON al.id = t.album_id
      WHERE t.user_id = ${userParam}
    ),
    filtered AS (
      SELECT * FROM base
      WHERE ${where.join(" AND ")}
    ),
    page AS (
      SELECT filtered.*, COUNT(*) OVER() AS total_count
      FROM filtered
      ORDER BY ${sort} ${dir} NULLS LAST, id ASC
      LIMIT ${limit} OFFSET ${offset}
    )
    SELECT
      page.*,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'id', ar.id,
          'name', ar.name
        ) ORDER BY ta.position), '[]'::json)
        FROM track_artists ta
        JOIN artists ar ON ar.id = ta.artist_id
        WHERE ta.track_id = page.id
      ) AS artists,
      (
        SELECT COALESCE(json_agg(json_build_object(
          'type', s.source_type,
          'label', CASE
            WHEN s.source_type = 'liked' THEN 'Liked'
            WHEN s.source_type = 'playlist' THEN pl.name
            ELSE 'Album'
          END,
          'playlistId', s.playlist_id,
          'albumId', s.album_id
        ) ORDER BY CASE s.source_type WHEN 'liked' THEN 0 WHEN 'playlist' THEN 1 ELSE 2 END, pl.name), '[]'::json)
        FROM track_sources s
        LEFT JOIN playlists pl ON pl.id = s.playlist_id
        WHERE s.track_id = page.id
      ) AS sources
    FROM page
    ORDER BY ${sort} ${dir} NULLS LAST, id ASC
  `;

  const result = await getPool().query<Row>(sql, values);
  return {
    total: result.rows.length ? Number(result.rows[0].total_count) : 0,
    rows: result.rows.map(mapRow),
  };
}

function mapRow(row: Row): LibraryRow {
  const added = row.added_at instanceof Date ? row.added_at.toISOString() : row.added_at;
  return {
    id: row.id,
    name: row.name,
    artists: row.artists ?? [],
    album: row.album_name,
    albumImage: row.album_image,
    year: row.release_year,
    addedAt: added,
    explicit: row.explicit,
    durationMs: row.duration_ms,
    uri: row.uri,
    sources: row.sources ?? [],
  };
}

export function toCsv(rows: LibraryRow[]) {
  const header = ["song", "artists", "album", "year", "date first added", "where it lives", "explicit", "duration_ms", "spotify_uri"];
  const lines = rows.map((row) =>
    [
      row.name,
      row.artists.map((artist) => artist.name).join("; "),
      row.album ?? "",
      row.year ?? "",
      row.addedAt ?? "",
      row.sources.map((source) => source.label).join("; "),
      row.explicit ? "yes" : "no",
      row.durationMs,
      row.uri,
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${header.join(",")}\n${lines.join("\n")}\n`;
}

function csvCell(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
