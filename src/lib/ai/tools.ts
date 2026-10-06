import { randomUUID } from "crypto";
import { getPool } from "@/db";
import { queryLibrary } from "../library/query";
import { libraryStats, type StatsGroup } from "../library/stats";
import { defaultFilters, type LibraryFilters, type LibraryRow, type LibrarySort, type LibraryView } from "../library/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_songs",
      description:
        "Search this user's library. Max 50 songs. Returns id, name, artists, album, year, explicit, duration_ms, added_at, sources. Use these ids in propose_playlist.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string" },
          artist: { type: "string" },
          release_year: { type: "integer" },
          release_year_from: { type: "integer" },
          release_year_to: { type: "integer" },
          decade: { type: "integer", description: "1970 for the 1970s" },
          added_year: { type: "integer", description: "When they saved it, not the release year" },
          added_from: { type: "string" },
          added_to: { type: "string" },
          source_scope: { type: "string", enum: ["added", "album", "all"] },
          source_type: { type: "string", enum: ["liked", "playlist", "album"] },
          playlist_name: { type: "string" },
          explicit: { type: "boolean" },
          genre: { type: "string" },
          limit: { type: "integer" },
          sort: { type: "string", enum: ["added", "year", "name"] },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "library_stats",
      description:
        "Counts in this user's library. group_by artist (primary artist), release_year, decade, playlist, or source. added_year means when they saved it.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          group_by: { type: "string", enum: ["artist", "release_year", "decade", "playlist", "source"] },
          release_year: { type: "integer" },
          release_year_from: { type: "integer" },
          release_year_to: { type: "integer" },
          decade: { type: "integer" },
          added_year: { type: "integer" },
          added_from: { type: "string" },
          added_to: { type: "string" },
          source_scope: { type: "string", enum: ["added", "album", "all"] },
          explicit: { type: "boolean" },
          playlist_name: { type: "string" },
          limit: { type: "integer" },
        },
        required: ["group_by"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_songs_by_ids",
      description: "Fetch compact rows for track ids that came from other tools. Unknown ids are listed, not invented.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { ids: { type: "array", items: { type: "string" } } },
        required: ["ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_playlist",
      description:
        "Draft a playlist from track ids returned by tools. Does not save to Spotify. Max 100 tracks. The user must click Save.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          track_ids: { type: "array", items: { type: "string" } },
        },
        required: ["name", "track_ids"],
      },
    },
  },
] as const;

export type ProposalTrack = { id: string; name: string; artists: string; durationMs: number };

export type ProposalCard = {
  id: string;
  name: string;
  description: string | null;
  trackCount: number;
  durationMs: number;
  status: "proposed" | "saved" | "failed";
  spotifyPlaylistId: string | null;
  error: string | null;
  tracks: ProposalTrack[];
};

export type ToolOutcome = { forModel: unknown; proposal?: ProposalCard };

function record(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
}

function str(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function num(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Math.trunc(Number(value));
  return undefined;
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function compact(row: LibraryRow) {
  return {
    id: row.id,
    name: row.name,
    artists: row.artists.map((artist) => artist.name).join(", "),
    album: row.album,
    year: row.year,
    explicit: row.explicit,
    duration_ms: row.durationMs,
    added_at: row.addedAt,
    sources: row.sources.map((source) => source.label),
  };
}

function filtersFromArgs(args: Record<string, unknown>, limit: number): LibraryFilters {
  const filters = defaultFilters();
  const scope = str(args.source_scope);
  filters.view = scope === "album" || scope === "all" ? scope : "added";
  filters.q = str(args.query) ?? "";
  filters.artist = str(args.artist) ?? "";
  filters.yearFrom = num(args.release_year_from) ?? null;
  filters.yearTo = num(args.release_year_to) ?? null;
  if (num(args.release_year) !== undefined) {
    filters.yearFrom = num(args.release_year)!;
    filters.yearTo = num(args.release_year)!;
  }
  const decade = num(args.decade);
  filters.decade = decade !== undefined ? decade - (decade % 10) : null;
  const source = str(args.source_type);
  if (source === "liked" || source === "playlist" || source === "album") filters.source = source;
  filters.playlistName = str(args.playlist_name) ?? null;
  filters.addedFrom = str(args.added_from) ?? null;
  filters.addedTo = str(args.added_to) ?? null;
  filters.addedYear = num(args.added_year) ?? null;
  const explicit = bool(args.explicit);
  if (explicit !== undefined) filters.explicit = explicit;
  filters.genre = str(args.genre) ?? null;
  const sort = str(args.sort);
  if (sort === "added" || sort === "year" || sort === "name" || sort === "artist" || sort === "album") {
    filters.sort = sort as LibrarySort;
  }
  filters.dir = filters.sort === "name" || filters.sort === "artist" || filters.sort === "album" ? "asc" : "desc";
  void limit;
  return filters;
}

async function rowsForIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const result = await getPool().query<{
    id: string;
    name: string;
    duration_ms: number;
    uri: string;
    artists: string | null;
  }>(
    `SELECT t.id, t.name, t.duration_ms, t.uri,
            (SELECT string_agg(ar.name, ', ' ORDER BY ta.position)
             FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
             WHERE ta.track_id = t.id) AS artists
     FROM tracks t
     WHERE t.user_id = $1 AND t.id = ANY($2::uuid[])`,
    [userId, ids],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is NonNullable<typeof row> => Boolean(row));
}

export async function executeTool(userId: string, name: string, rawArgs: unknown): Promise<ToolOutcome> {
  const args = record(rawArgs);
  if (name === "search_songs") {
    const limit = Math.min(Math.max(num(args.limit) ?? 25, 1), 50);
    const filters = filtersFromArgs(args, limit);
    const result = await queryLibrary(userId, filters, { limit, offset: 0 });
    return {
      forModel: {
        total: result.total,
        returned: result.rows.length,
        warning: result.warning,
        songs: result.rows.map(compact),
      },
    };
  }
  if (name === "library_stats") {
    const group = str(args.group_by);
    const allowed: StatsGroup[] = ["artist", "release_year", "decade", "playlist", "source"];
    if (!group || !allowed.includes(group as StatsGroup)) {
      return { forModel: { error: "group_by must be artist, release_year, decade, playlist, or source." } };
    }
    const scope = str(args.source_scope);
    const rows = await libraryStats(userId, {
      groupBy: group as StatsGroup,
      releaseYear: num(args.release_year),
      releaseYearFrom: num(args.release_year_from),
      releaseYearTo: num(args.release_year_to),
      decade: num(args.decade) !== undefined ? num(args.decade)! - (num(args.decade)! % 10) : undefined,
      addedYear: num(args.added_year),
      addedFrom: str(args.added_from),
      addedTo: str(args.added_to),
      sourceScope: scope === "album" || scope === "all" || scope === "added" ? (scope as LibraryView) : "added",
      explicit: bool(args.explicit),
      playlistName: str(args.playlist_name),
      limit: num(args.limit),
    });
    return { forModel: { group_by: group, rows } };
  }
  if (name === "get_songs_by_ids") {
    const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === "string").slice(0, 50) : [];
    const valid = ids.filter((id) => UUID.test(id));
    const rows = await rowsForIds(userId, valid);
    const found = new Set(rows.map((row) => row.id));
    return {
      forModel: {
        songs: rows.map((row) => ({
          id: row.id,
          name: row.name,
          artists: row.artists,
          duration_ms: row.duration_ms,
        })),
        missing_ids: ids.filter((id) => !found.has(id)),
      },
    };
  }
  if (name === "propose_playlist") {
    const title = str(args.name)?.slice(0, 100);
    if (!title) return { forModel: { error: "A playlist name is required." } };
    const requested = Array.isArray(args.track_ids) ? args.track_ids.filter((id): id is string => typeof id === "string") : [];
    const ordered = [...new Set(requested)].slice(0, 100);
    if (!ordered.length) return { forModel: { error: "track_ids is empty." } };
    if (ordered.length < requested.length && requested.length > 100) {
      return { forModel: { error: "Too many tracks. Propose at most 100, or tell the user to save the filtered view." } };
    }
    const invalid = ordered.filter((id) => !UUID.test(id));
    const rows = await rowsForIds(userId, ordered.filter((id) => UUID.test(id)));
    const found = new Set(rows.map((row) => row.id));
    const missing = [...invalid, ...ordered.filter((id) => UUID.test(id) && !found.has(id))];
    if (missing.length || rows.length !== ordered.filter((id) => UUID.test(id)).length) {
      return { forModel: { error: "Unknown track ids. Only use ids from tool results.", missing_ids: missing } };
    }
    const inOrder = ordered.map((id) => rows.find((row) => row.id === id)!);
    const description = str(args.description)?.slice(0, 300) ?? null;
    const id = randomUUID();
    await getPool().query(
      `INSERT INTO playlist_proposals (id, user_id, name, description, track_ids) VALUES ($1, $2, $3, $4, $5::uuid[])`,
      [id, userId, title, description, inOrder.map((row) => row.id)],
    );
    const proposal: ProposalCard = {
      id,
      name: title,
      description,
      trackCount: inOrder.length,
      durationMs: inOrder.reduce((sum, row) => sum + row.duration_ms, 0),
      status: "proposed",
      spotifyPlaylistId: null,
      error: null,
      tracks: inOrder.map((row) => ({
        id: row.id,
        name: row.name,
        artists: row.artists ?? "",
        durationMs: row.duration_ms,
      })),
    };
    return {
      proposal,
      forModel: {
        proposal_id: id,
        name: title,
        track_count: proposal.trackCount,
        duration_ms: proposal.durationMs,
        note: "Draft only. The user saves it to Spotify.",
      },
    };
  }
  return { forModel: { error: `Unknown tool ${name}` } };
}
