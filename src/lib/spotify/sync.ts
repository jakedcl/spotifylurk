import { getPool } from "@/db";
import { loadDedupeIndex, persistTracks } from "../library/persist";
import { SpotifyApiError, SpotifyRateLimit, type SpotifyClient } from "./client";
import { parseAlbum, parseLibraryItem, parsePage, playlistTrackTotal, type SpotifyPage } from "./parse";

export type SyncProgress = {
  phase: string;
  label: string;
  done: number;
  total: number | null;
};

type PlaylistJob = { spotifyId: string; dbId: string; offset: number; name: string };
type AlbumJob = { spotifyId: string; dbId: string; offset: number; name: string; addedAt: string | null };

export type SyncCursor = {
  phase: "liked" | "playlists" | "playlist_items" | "albums" | "album_tracks" | "finalize";
  offset: number;
  seenPlaylistIds: string[];
  playlistQueue: PlaylistJob[];
  playlistPos: number;
  albumQueue: AlbumJob[];
  albumPos: number;
};

export type SyncStepResult = {
  status: "running" | "done" | "error";
  progress: SyncProgress;
  retryAfter: number | null;
  error: string | null;
};

const UNAVAILABLE =
  "Spotify only returns tracks for playlists you own or collaborate on. Followed playlists are listed without their songs.";

function initialCursor(): SyncCursor {
  return {
    phase: "liked",
    offset: 0,
    seenPlaylistIds: [],
    playlistQueue: [],
    playlistPos: 0,
    albumQueue: [],
    albumPos: 0,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readCursor(value: unknown): SyncCursor {
  const record = asRecord(value) ?? {};
  const phase = asString(record.phase);
  const allowed = ["liked", "playlists", "playlist_items", "albums", "album_tracks", "finalize"];
  return {
    phase: allowed.includes(phase ?? "") ? (phase as SyncCursor["phase"]) : "liked",
    offset: typeof record.offset === "number" ? record.offset : 0,
    seenPlaylistIds: Array.isArray(record.seenPlaylistIds) ? record.seenPlaylistIds.filter((id) => typeof id === "string") : [],
    playlistQueue: Array.isArray(record.playlistQueue) ? (record.playlistQueue as PlaylistJob[]) : [],
    playlistPos: typeof record.playlistPos === "number" ? record.playlistPos : 0,
    albumQueue: Array.isArray(record.albumQueue) ? (record.albumQueue as AlbumJob[]) : [],
    albumPos: typeof record.albumPos === "number" ? record.albumPos : 0,
  };
}

function imageUrl(images: unknown) {
  if (!Array.isArray(images) || images.length === 0) return null;
  const last = asRecord(images[images.length - 1]);
  return asString(last?.url);
}

function consume(page: SpotifyPage, fallbackOffset: number) {
  if (page.items.length === 0 && page.next) {
    return { offset: fallbackOffset + (page.limit || 50), done: false };
  }
  return { offset: (page.offset || fallbackOffset) + page.items.length, done: !page.next };
}

async function saveRun(
  runId: string,
  cursor: SyncCursor,
  progress: SyncProgress,
  status: "running" | "done" | "error",
  error?: string | null,
) {
  await getPool().query(
    `UPDATE sync_runs
     SET status = $2, phase = $3, cursor = $4, progress = $5, error = $6,
         updated_at = now(),
         finished_at = CASE WHEN $2 = 'running' THEN NULL ELSE now() END
     WHERE id = $1`,
    [runId, status, cursor.phase, JSON.stringify(cursor), JSON.stringify(progress), error ?? null],
  );
}

export async function startSync(userId: string) {
  const pool = getPool();
  await pool.query(
    `UPDATE sync_runs
     SET status = 'error', error = 'Timed out', finished_at = now(), updated_at = now()
     WHERE user_id = $1 AND status = 'running' AND updated_at < now() - interval '15 minutes'`,
    [userId],
  );
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM sync_runs WHERE user_id = $1 AND status = 'running' ORDER BY started_at DESC LIMIT 1`,
    [userId],
  );
  if (existing.rows[0]) return { runId: existing.rows[0].id, alreadyRunning: true };
  const cursor = initialCursor();
  const progress: SyncProgress = { phase: "liked", label: "Starting", done: 0, total: null };
  const inserted = await pool.query<{ id: string }>(
    `INSERT INTO sync_runs (user_id, status, phase, cursor, progress)
     VALUES ($1, 'running', 'liked', $2::jsonb, $3::jsonb)
     RETURNING id`,
    [userId, JSON.stringify(cursor), JSON.stringify(progress)],
  );
  return { runId: inserted.rows[0].id, alreadyRunning: false };
}

async function fetchPlaylistItems(client: SpotifyClient, playlistId: string, offset: number) {
  try {
    const page = parsePage(await client.get(`/v1/playlists/${playlistId}/items`, { limit: 50, offset }));
    return { page, unavailable: false };
  } catch (error) {
    if (!(error instanceof SpotifyApiError) || (error.status !== 403 && error.status !== 404)) throw error;
    try {
      const page = parsePage(await client.get(`/v1/playlists/${playlistId}/tracks`, { limit: 50, offset }));
      return { page, unavailable: false };
    } catch (fallback) {
      if (fallback instanceof SpotifyApiError && (fallback.status === 403 || fallback.status === 404)) {
        return { page: null, unavailable: true };
      }
      throw fallback;
    }
  }
}

export async function runSyncStep(opts: {
  userId: string;
  spotifyUserId: string;
  client: SpotifyClient;
  maxPages?: number;
  deadlineMs?: number;
}): Promise<SyncStepResult> {
  const pool = getPool();
  const run = await pool.query<{ id: string; cursor: unknown; progress: unknown }>(
    `SELECT id, cursor, progress FROM sync_runs
     WHERE user_id = $1 AND status = 'running'
     ORDER BY started_at DESC LIMIT 1`,
    [opts.userId],
  );
  if (!run.rows[0]) {
    return {
      status: "error",
      progress: { phase: "error", label: "No sync is running", done: 0, total: null },
      retryAfter: null,
      error: "Start a sync first.",
    };
  }

  const runId = run.rows[0].id;
  const cursor = readCursor(run.rows[0].cursor);
  let progress: SyncProgress = (asRecord(run.rows[0].progress) as SyncProgress | null) ?? {
    phase: cursor.phase,
    label: "Syncing",
    done: 0,
    total: null,
  };
  const index = await loadDedupeIndex(opts.userId);
  const deadline = Date.now() + (opts.deadlineMs ?? 7000);
  const maxPages = opts.maxPages ?? 8;
  let pages = 0;

  try {
    while (pages < maxPages && Date.now() < deadline && cursor.phase !== "finalize") {
      await runPage(opts.userId, opts.spotifyUserId, runId, opts.client, cursor, index, (next) => {
        progress = next;
      });
      pages += 1;
      await saveRun(runId, cursor, progress, "running");
    }
    if (cursor.phase === "finalize") {
      await pool.query(
        `DELETE FROM track_sources
         WHERE user_id = $1 AND source_type = 'album' AND seen_run_id IS DISTINCT FROM $2`,
        [opts.userId, runId],
      );
      progress = { phase: "done", label: "Library updated", done: progress.done, total: progress.total };
      await saveRun(runId, cursor, progress, "done");
      return { status: "done", progress, retryAfter: null, error: null };
    }
    return { status: "running", progress, retryAfter: null, error: null };
  } catch (error) {
    if (error instanceof SpotifyRateLimit) {
      progress = { ...progress, label: `Waiting on Spotify (${error.retryAfterSeconds}s)` };
      await saveRun(runId, cursor, progress, "running");
      return { status: "running", progress, retryAfter: error.retryAfterSeconds, error: null };
    }
    const message = error instanceof SpotifyApiError ? error.message : "Sync failed.";
    if (!(error instanceof SpotifyApiError)) console.error(error);
    progress = { phase: "error", label: "Sync failed", done: progress.done, total: progress.total };
    await saveRun(runId, cursor, progress, "error", message);
    return { status: "error", progress, retryAfter: null, error: message };
  }
}

async function runPage(
  userId: string,
  spotifyUserId: string,
  runId: string,
  client: SpotifyClient,
  cursor: SyncCursor,
  index: Awaited<ReturnType<typeof loadDedupeIndex>>,
  setProgress: (progress: SyncProgress) => void,
) {
  if (cursor.phase === "liked") {
    const page = parsePage(await client.get("/v1/me/tracks", { limit: 50, offset: cursor.offset }));
    const items = page.items
      .map((item) => parseLibraryItem(item))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({ track: item.track, sourceType: "liked" as const, playlistId: null, addedAt: item.addedAt }));
    await persistTracks(userId, runId, index, items);
    const next = consume(page, cursor.offset);
    cursor.offset = next.offset;
    setProgress({ phase: "liked", label: "Liked songs", done: cursor.offset, total: page.total });
    if (next.done) {
      await getPool().query(
        `DELETE FROM track_sources
         WHERE user_id = $1 AND source_type = 'liked' AND seen_run_id IS DISTINCT FROM $2`,
        [userId, runId],
      );
      cursor.phase = "playlists";
      cursor.offset = 0;
    }
    return;
  }

  if (cursor.phase === "playlists") {
    const page = parsePage(await client.get("/v1/me/playlists", { limit: 50, offset: cursor.offset }));
    for (const raw of page.items) {
      const record = asRecord(raw);
      const spotifyId = asString(record?.id);
      const name = asString(record?.name);
      if (!record || !spotifyId || !name) continue;
      cursor.seenPlaylistIds.push(spotifyId);
      const owner = asRecord(record.owner);
      const ownerId = asString(owner?.id);
      const collaborative = record.collaborative === true;
      const followedOnly = Boolean(ownerId) && ownerId !== spotifyUserId && !collaborative;
      const previous = await getPool().query<{ id: string; snapshot_id: string | null; source_count: number }>(
        `SELECT id, snapshot_id,
                (SELECT count(*)::int FROM track_sources s WHERE s.playlist_id = playlists.id) AS source_count
         FROM playlists
         WHERE user_id = $1 AND spotify_id = $2`,
        [userId, spotifyId],
      );
      const snapshotId = asString(record.snapshot_id);
      const saved = await getPool().query<{ id: string }>(
        `INSERT INTO playlists (
           user_id, spotify_id, name, description, owner_spotify_id, owner_name, collaborative, is_public,
           snapshot_id, track_count, tracks_unavailable, unavailable_reason, image_url, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (user_id, spotify_id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           owner_spotify_id = EXCLUDED.owner_spotify_id,
           owner_name = EXCLUDED.owner_name,
           collaborative = EXCLUDED.collaborative,
           is_public = EXCLUDED.is_public,
           snapshot_id = EXCLUDED.snapshot_id,
           track_count = EXCLUDED.track_count,
           tracks_unavailable = EXCLUDED.tracks_unavailable,
           unavailable_reason = EXCLUDED.unavailable_reason,
           image_url = EXCLUDED.image_url,
           updated_at = now()
         RETURNING id`,
        [
          userId,
          spotifyId,
          name,
          asString(record.description),
          ownerId,
          asString(owner?.display_name),
          collaborative,
          typeof record.public === "boolean" ? record.public : null,
          snapshotId,
          playlistTrackTotal(record),
          followedOnly,
          followedOnly ? UNAVAILABLE : null,
          imageUrl(record.images),
        ],
      );
      const dbId = saved.rows[0].id;
      const unchanged =
        !followedOnly &&
        snapshotId &&
        previous.rows[0]?.snapshot_id === snapshotId &&
        previous.rows[0].source_count > 0;
      if (unchanged) {
        await getPool().query(
          `UPDATE track_sources SET seen_run_id = $3 WHERE user_id = $1 AND playlist_id = $2`,
          [userId, dbId, runId],
        );
        continue;
      }
      if (!followedOnly) {
        cursor.playlistQueue.push({ spotifyId, dbId, offset: 0, name });
      }
    }
    const next = consume(page, cursor.offset);
    cursor.offset = next.offset;
    setProgress({
      phase: "playlists",
      label: "Playlists",
      done: cursor.seenPlaylistIds.length,
      total: page.total,
    });
    if (next.done) {
      await getPool().query(
        `DELETE FROM playlists WHERE user_id = $1 AND NOT (spotify_id = ANY($2::text[]))`,
        [userId, cursor.seenPlaylistIds],
      );
      cursor.phase = "playlist_items";
      cursor.offset = 0;
    }
    return;
  }

  if (cursor.phase === "playlist_items") {
    const job = cursor.playlistQueue[cursor.playlistPos];
    if (!job) {
      cursor.phase = "albums";
      cursor.offset = 0;
      setProgress({ phase: "playlist_items", label: "Playlists", done: cursor.playlistPos, total: cursor.playlistQueue.length });
      return;
    }
    const fetched = await fetchPlaylistItems(client, job.spotifyId, job.offset);
    if (fetched.unavailable || !fetched.page) {
      await getPool().query(
        `UPDATE playlists SET tracks_unavailable = true, unavailable_reason = $3, updated_at = now() WHERE id = $1 AND user_id = $2`,
        [job.dbId, userId, UNAVAILABLE],
      );
      cursor.playlistPos += 1;
      setProgress({ phase: "playlist_items", label: job.name, done: cursor.playlistPos, total: cursor.playlistQueue.length });
      return;
    }
    const page = fetched.page;
    const items = page.items
      .map((item) => parseLibraryItem(item))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({
        track: item.track,
        sourceType: "playlist" as const,
        playlistId: job.dbId,
        addedAt: item.addedAt,
      }));
    await persistTracks(userId, runId, index, items);
    const next = consume(page, job.offset);
    job.offset = next.offset;
    setProgress({ phase: "playlist_items", label: job.name, done: job.offset, total: page.total });
    if (next.done) {
      await getPool().query(
        `DELETE FROM track_sources
         WHERE user_id = $1 AND playlist_id = $2 AND seen_run_id IS DISTINCT FROM $3`,
        [userId, job.dbId, runId],
      );
      await getPool().query(
        `UPDATE playlists SET tracks_unavailable = false, unavailable_reason = NULL, updated_at = now() WHERE id = $1`,
        [job.dbId],
      );
      cursor.playlistPos += 1;
    }
    return;
  }

  if (cursor.phase === "albums") {
    const page = parsePage(await client.get("/v1/me/albums", { limit: 50, offset: cursor.offset }));
    for (const raw of page.items) {
      const record = asRecord(raw);
      const album = parseAlbum(record?.album);
      if (!record || !album) continue;
      const addedAt = asString(record.added_at);
      const saved = await getPool().query<{ id: string }>(
        `INSERT INTO albums (user_id, spotify_id, name, release_date, release_year, album_type, image_url, total_tracks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, spotify_id) DO UPDATE SET
           name = EXCLUDED.name,
           release_date = COALESCE(EXCLUDED.release_date, albums.release_date),
           release_year = COALESCE(EXCLUDED.release_year, albums.release_year),
           album_type = COALESCE(EXCLUDED.album_type, albums.album_type),
           image_url = COALESCE(EXCLUDED.image_url, albums.image_url),
           total_tracks = COALESCE(EXCLUDED.total_tracks, albums.total_tracks)
         RETURNING id`,
        [userId, album.spotifyId, album.name, album.releaseDate, album.releaseYear, album.albumType, album.imageUrl, album.totalTracks],
      );
      const tracks = asRecord(asRecord(record.album)?.tracks);
      if (!tracks) {
        cursor.albumQueue.push({
          spotifyId: album.spotifyId,
          dbId: saved.rows[0].id,
          offset: 0,
          name: album.name,
          addedAt,
        });
      } else {
        const embedded = parsePage(tracks);
        const items = embedded.items
          .map((item) => parseLibraryItem(item, album, addedAt))
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => ({ track: item.track, sourceType: "album" as const, playlistId: null, addedAt: item.addedAt }));
        await persistTracks(userId, runId, index, items);
        if (embedded.next) {
          cursor.albumQueue.push({
            spotifyId: album.spotifyId,
            dbId: saved.rows[0].id,
            offset: embedded.offset + embedded.items.length,
            name: album.name,
            addedAt,
          });
        }
      }
    }
    const next = consume(page, cursor.offset);
    cursor.offset = next.offset;
    setProgress({ phase: "albums", label: "Saved albums", done: cursor.offset, total: page.total });
    if (next.done) {
      cursor.phase = "album_tracks";
      cursor.offset = 0;
    }
    return;
  }

  if (cursor.phase === "album_tracks") {
    const job = cursor.albumQueue[cursor.albumPos];
    if (!job) {
      cursor.phase = "finalize";
      setProgress({ phase: "album_tracks", label: "Albums", done: cursor.albumPos, total: cursor.albumQueue.length });
      return;
    }
    const albumRow = await getPool().query<{
      name: string;
      release_date: string | null;
      release_year: number | null;
      album_type: string | null;
      image_url: string | null;
      total_tracks: number | null;
    }>(`SELECT name, release_date, release_year, album_type, image_url, total_tracks FROM albums WHERE id = $1`, [job.dbId]);
    const album = albumRow.rows[0];
    const page = parsePage(
      await client.get(`/v1/albums/${job.spotifyId}/tracks`, { limit: 50, offset: job.offset }),
    );
    const fallback = album
      ? {
          spotifyId: job.spotifyId,
          name: album.name,
          releaseDate: album.release_date,
          releaseYear: album.release_year,
          albumType: album.album_type,
          imageUrl: album.image_url,
          totalTracks: album.total_tracks,
        }
      : null;
    const items = page.items
      .map((item) => parseLibraryItem(item, fallback, job.addedAt))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
      .map((item) => ({ track: item.track, sourceType: "album" as const, playlistId: null, addedAt: item.addedAt }));
    await persistTracks(userId, runId, index, items);
    const next = consume(page, job.offset);
    job.offset = next.offset;
    setProgress({ phase: "album_tracks", label: job.name, done: job.offset, total: page.total });
    if (next.done) cursor.albumPos += 1;
  }
}
