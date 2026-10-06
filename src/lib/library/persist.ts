import { randomUUID } from "crypto";
import { getPool } from "@/db";
import { dedupeKeyFor, emptyIndex, matchTrack, remember, retarget, type DedupeIndex } from "./dedupe";
import { normalizeText, searchText } from "./normalize";
import type { ParsedTrack } from "../spotify/parse";
import type { SourceType } from "./types";

const RANK: Record<SourceType, number> = { album: 0, playlist: 1, liked: 2 };

export type PersistItem = {
  track: ParsedTrack;
  sourceType: SourceType;
  playlistId: string | null;
  addedAt: string | null;
};

type Draft = {
  id: string;
  isNew: boolean;
  rank: number;
  explicit: boolean;
  track: ParsedTrack;
};

export async function loadDedupeIndex(userId: string): Promise<DedupeIndex> {
  const result = await getPool().query<{
    id: string;
    normalized_name: string;
    primary_artist_key: string;
    isrc: string | null;
    uri: string | null;
  }>(
    `SELECT t.id, t.normalized_name, t.primary_artist_key, t.isrc, a.uri
     FROM tracks t
     LEFT JOIN track_aliases a ON a.track_id = t.id AND a.user_id = t.user_id
     WHERE t.user_id = $1`,
    [userId],
  );
  const index = emptyIndex();
  for (const row of result.rows) {
    remember(index, row.id, {
      uri: row.uri ?? "",
      spotifyId: "",
      name: row.normalized_name,
      isrc: row.isrc,
      primaryArtist: row.primary_artist_key,
    });
  }
  return index;
}

export async function persistTracks(userId: string, runId: string, index: DedupeIndex, items: PersistItem[]) {
  if (!items.length) return 0;
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const artistMap = new Map<string, { spotify_id: string; name: string }>();
    const albumMap = new Map<
      string,
      {
        spotify_id: string;
        name: string;
        release_date: string | null;
        release_year: number | null;
        album_type: string | null;
        image_url: string | null;
        total_tracks: number | null;
      }
    >();
    for (const item of items) {
      for (const artist of item.track.artists) {
        artistMap.set(artist.spotifyId, { spotify_id: artist.spotifyId, name: artist.name });
      }
      if (item.track.album) {
        albumMap.set(item.track.album.spotifyId, {
          spotify_id: item.track.album.spotifyId,
          name: item.track.album.name,
          release_date: item.track.album.releaseDate,
          release_year: item.track.album.releaseYear,
          album_type: item.track.album.albumType,
          image_url: item.track.album.imageUrl,
          total_tracks: item.track.album.totalTracks,
        });
      }
    }

    const artistIds = new Map<string, string>();
    if (artistMap.size) {
      const inserted = await client.query<{ id: string; spotify_id: string }>(
        `INSERT INTO artists (user_id, spotify_id, name)
         SELECT $1, spotify_id, name
         FROM json_to_recordset($2::json) AS x(spotify_id text, name text)
         ON CONFLICT (user_id, spotify_id) DO UPDATE SET name = EXCLUDED.name
         RETURNING id, spotify_id`,
        [userId, JSON.stringify([...artistMap.values()])],
      );
      for (const row of inserted.rows) artistIds.set(row.spotify_id, row.id);
    }

    const albumIds = new Map<string, string>();
    if (albumMap.size) {
      const inserted = await client.query<{ id: string; spotify_id: string }>(
        `INSERT INTO albums (user_id, spotify_id, name, release_date, release_year, album_type, image_url, total_tracks)
         SELECT $1, spotify_id, name, release_date, release_year, album_type, image_url, total_tracks
         FROM json_to_recordset($2::json) AS x(
           spotify_id text, name text, release_date text, release_year int, album_type text, image_url text, total_tracks int
         )
         ON CONFLICT (user_id, spotify_id) DO UPDATE SET
           name = EXCLUDED.name,
           release_date = COALESCE(EXCLUDED.release_date, albums.release_date),
           release_year = COALESCE(EXCLUDED.release_year, albums.release_year),
           album_type = COALESCE(EXCLUDED.album_type, albums.album_type),
           image_url = COALESCE(EXCLUDED.image_url, albums.image_url),
           total_tracks = COALESCE(EXCLUDED.total_tracks, albums.total_tracks)
         RETURNING id, spotify_id`,
        [userId, JSON.stringify([...albumMap.values()])],
      );
      for (const row of inserted.rows) albumIds.set(row.spotify_id, row.id);
    }

    const drafts = new Map<string, Draft>();
    const aliasList: { track_id: string; spotify_id: string; uri: string; isrc: string | null }[] = [];
    const sources: {
      track_id: string;
      source_type: SourceType;
      playlist_id: string | null;
      album_id: string | null;
      added_at: string | null;
    }[] = [];

    for (const item of items) {
      const primary = item.track.artists[0]?.name ?? "";
      const identity = {
        uri: item.track.uri,
        spotifyId: item.track.spotifyId,
        name: item.track.name,
        isrc: item.track.isrc,
        primaryArtist: primary,
      };
      const matched = matchTrack(index, identity);
      const id = matched?.trackId ?? randomUUID();
      const isNew = !matched;
      remember(index, id, identity);
      aliasList.push({
        track_id: id,
        spotify_id: item.track.spotifyId,
        uri: item.track.uri,
        isrc: item.track.isrc,
      });
      const rank = RANK[item.sourceType];
      const current = drafts.get(id);
      const mergedTrack = { ...item.track, isrc: item.track.isrc ?? current?.track.isrc ?? null };
      if (!current || rank >= current.rank) {
        drafts.set(id, {
          id,
          isNew: current ? current.isNew : isNew,
          rank,
          explicit: Boolean(current?.explicit) || item.track.explicit,
          track: mergedTrack,
        });
      } else {
        if (item.track.isrc && !current.track.isrc) current.track = { ...current.track, isrc: item.track.isrc };
        if (item.track.explicit) current.explicit = true;
      }
      const albumId = item.track.album ? (albumIds.get(item.track.album.spotifyId) ?? null) : null;
      if (item.sourceType === "liked") {
        sources.push({ track_id: id, source_type: "liked", playlist_id: null, album_id: null, added_at: item.addedAt });
      } else if (item.sourceType === "playlist" && item.playlistId) {
        sources.push({
          track_id: id,
          source_type: "playlist",
          playlist_id: item.playlistId,
          album_id: null,
          added_at: item.addedAt,
        });
      } else if (item.sourceType === "album" && albumId) {
        sources.push({
          track_id: id,
          source_type: "album",
          playlist_id: null,
          album_id: albumId,
          added_at: item.addedAt,
        });
      }
    }

    const toRow = (draft: Draft) => {
      const primary = draft.track.artists[0]?.name ?? "";
      const albumId = draft.track.album ? (albumIds.get(draft.track.album.spotifyId) ?? null) : null;
      return {
        id: draft.id,
        spotify_id: draft.track.spotifyId,
        uri: draft.track.uri,
        name: draft.track.name,
        normalized_name: normalizeText(draft.track.name),
        primary_artist_key: normalizeText(primary),
        isrc: draft.track.isrc,
        dedupe_key: dedupeKeyFor({ isrc: draft.track.isrc, name: draft.track.name, primaryArtist: primary }),
        duration_ms: draft.track.durationMs,
        explicit: draft.explicit,
        popularity: draft.track.popularity,
        disc_number: draft.track.discNumber,
        track_number: draft.track.trackNumber,
        album_id: albumId,
        release_year: draft.track.album?.releaseYear ?? null,
        search_text: searchText(
          draft.track.name,
          draft.track.artists.map((artist) => artist.name),
          draft.track.album?.name ?? null,
        ),
        canonical_rank: draft.rank,
      };
    };

    const fresh = [...drafts.values()].filter((draft) => draft.isNew).map(toRow);
    const existing = [...drafts.values()].filter((draft) => !draft.isNew).map(toRow);
    const idRewrites = new Map<string, string>();

    if (fresh.length) {
      const inserted = await client.query<{ id: string; dedupe_key: string }>(
        `INSERT INTO tracks (
           id, user_id, spotify_id, uri, name, normalized_name, primary_artist_key, isrc, dedupe_key,
           duration_ms, explicit, popularity, disc_number, track_number, album_id, release_year, search_text, canonical_rank
         )
         SELECT id, $1, spotify_id, uri, name, normalized_name, primary_artist_key, isrc, dedupe_key,
           duration_ms, explicit, popularity, disc_number, track_number, album_id, release_year, search_text, canonical_rank
         FROM json_to_recordset($2::json) AS x(
           id uuid, spotify_id text, uri text, name text, normalized_name text, primary_artist_key text, isrc text,
           dedupe_key text, duration_ms int, explicit boolean, popularity int, disc_number int, track_number int,
           album_id uuid, release_year int, search_text text, canonical_rank int
         )
         ON CONFLICT (user_id, dedupe_key) DO UPDATE SET
           isrc = COALESCE(tracks.isrc, EXCLUDED.isrc),
           explicit = tracks.explicit OR EXCLUDED.explicit,
           updated_at = now()
         RETURNING id, dedupe_key`,
        [userId, JSON.stringify(fresh)],
      );
      const actualByKey = new Map(inserted.rows.map((row) => [row.dedupe_key, row.id]));
      for (const row of fresh) {
        const actual = actualByKey.get(row.dedupe_key);
        if (actual && actual !== row.id) {
          idRewrites.set(row.id, actual);
          retarget(index, row.id, actual);
        }
      }
    }

    const rewrite = (id: string) => idRewrites.get(id) ?? id;

    if (existing.length) {
      await client.query(
        `UPDATE tracks AS t SET
           spotify_id = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.spotify_id ELSE t.spotify_id END,
           uri = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.uri ELSE t.uri END,
           name = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.name ELSE t.name END,
           normalized_name = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.normalized_name ELSE t.normalized_name END,
           primary_artist_key = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.primary_artist_key ELSE t.primary_artist_key END,
           search_text = CASE WHEN x.canonical_rank > t.canonical_rank THEN x.search_text ELSE t.search_text END,
           album_id = CASE
             WHEN x.canonical_rank > t.canonical_rank THEN COALESCE(x.album_id, t.album_id)
             ELSE COALESCE(t.album_id, x.album_id)
           END,
           release_year = COALESCE(t.release_year, x.release_year),
           isrc = COALESCE(t.isrc, x.isrc),
           explicit = t.explicit OR x.explicit,
           duration_ms = CASE WHEN t.duration_ms = 0 THEN x.duration_ms ELSE t.duration_ms END,
           popularity = COALESCE(t.popularity, x.popularity),
           canonical_rank = GREATEST(t.canonical_rank, x.canonical_rank),
           updated_at = now()
         FROM json_to_recordset($2::json) AS x(
           id uuid, spotify_id text, uri text, name text, normalized_name text, primary_artist_key text,
           search_text text, album_id uuid, release_year int, isrc text, explicit boolean, duration_ms int,
           popularity int, canonical_rank int
         )
         WHERE t.id = x.id AND t.user_id = $1`,
        [
          userId,
          JSON.stringify(
            existing.map((row) => ({
              id: row.id,
              spotify_id: row.spotify_id,
              uri: row.uri,
              name: row.name,
              normalized_name: row.normalized_name,
              primary_artist_key: row.primary_artist_key,
              search_text: row.search_text,
              album_id: row.album_id,
              release_year: row.release_year,
              isrc: row.isrc,
              explicit: row.explicit,
              duration_ms: row.duration_ms,
              popularity: row.popularity,
              canonical_rank: row.canonical_rank,
            })),
          ),
        ],
      );
    }

    const aliases = new Map<string, { track_id: string; spotify_id: string; uri: string; isrc: string | null }>();
    for (const alias of aliasList) {
      aliases.set(alias.uri, { ...alias, track_id: rewrite(alias.track_id) });
    }
    if (aliases.size) {
      await client.query(
        `INSERT INTO track_aliases (user_id, track_id, spotify_id, uri, isrc)
         SELECT $1, track_id, spotify_id, uri, isrc
         FROM json_to_recordset($2::json) AS x(track_id uuid, spotify_id text, uri text, isrc text)
         ON CONFLICT (user_id, uri) DO UPDATE SET
           track_id = EXCLUDED.track_id,
           isrc = COALESCE(track_aliases.isrc, EXCLUDED.isrc)`,
        [userId, JSON.stringify([...aliases.values()])],
      );
    }

    const links = new Map<string, { track_id: string; artist_id: string; position: number }>();
    for (const draft of drafts.values()) {
      draft.track.artists.forEach((artist, position) => {
        const artistId = artistIds.get(artist.spotifyId);
        if (!artistId) return;
        const trackId = rewrite(draft.id);
        links.set(`${trackId}:${artistId}`, { track_id: trackId, artist_id: artistId, position });
      });
    }
    if (links.size) {
      await client.query(
        `INSERT INTO track_artists (track_id, artist_id, position)
         SELECT track_id, artist_id, position
         FROM json_to_recordset($1::json) AS x(track_id uuid, artist_id uuid, position int)
         ON CONFLICT (track_id, artist_id) DO NOTHING`,
        [JSON.stringify([...links.values()])],
      );
    }

    const sourceMap = new Map<string, (typeof sources)[number]>();
    for (const source of sources) {
      const trackId = rewrite(source.track_id);
      const key = `${trackId}:${source.source_type}:${source.playlist_id ?? ""}:${source.album_id ?? ""}`;
      const previous = sourceMap.get(key);
      if (!previous) {
        sourceMap.set(key, { ...source, track_id: trackId });
        continue;
      }
      if (source.added_at && (!previous.added_at || source.added_at < previous.added_at)) previous.added_at = source.added_at;
    }
    if (sourceMap.size) {
      await client.query(
        `INSERT INTO track_sources (user_id, track_id, source_type, playlist_id, album_id, added_at, seen_run_id)
         SELECT $1, track_id, source_type, playlist_id, album_id, added_at, $2
         FROM json_to_recordset($3::json) AS x(
           track_id uuid, source_type text, playlist_id uuid, album_id uuid, added_at timestamptz
         )
         ON CONFLICT ON CONSTRAINT track_sources_identity DO UPDATE SET
           seen_run_id = EXCLUDED.seen_run_id,
           added_at = CASE
             WHEN track_sources.added_at IS NULL THEN EXCLUDED.added_at
             WHEN EXCLUDED.added_at IS NULL THEN track_sources.added_at
             ELSE LEAST(track_sources.added_at, EXCLUDED.added_at)
           END`,
        [userId, runId, JSON.stringify([...sourceMap.values()])],
      );
    }

    await client.query("COMMIT");
    return sourceMap.size;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
