import { releaseYearFromDate } from "../library/normalize";

export type ParsedArtist = { spotifyId: string; name: string };

export type ParsedAlbum = {
  spotifyId: string;
  name: string;
  releaseDate: string | null;
  releaseYear: number | null;
  albumType: string | null;
  imageUrl: string | null;
  totalTracks: number | null;
};

export type ParsedTrack = {
  spotifyId: string;
  uri: string;
  name: string;
  isrc: string | null;
  durationMs: number;
  explicit: boolean;
  popularity: number | null;
  discNumber: number | null;
  trackNumber: number | null;
  artists: ParsedArtist[];
  album: ParsedAlbum | null;
};

export type ParsedLibraryItem = {
  track: ParsedTrack;
  addedAt: string | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseArtists(value: unknown): ParsedArtist[] {
  if (!Array.isArray(value)) return [];
  const artists: ParsedArtist[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    const spotifyId = asString(record?.id);
    const name = asString(record?.name);
    if (spotifyId && name) artists.push({ spotifyId, name });
  }
  return artists;
}

function pickImage(value: unknown) {
  if (!Array.isArray(value)) return null;
  const images = value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry?.url));
  if (!images.length) return null;
  const small = images.find((image) => {
    const width = asNumber(image.width);
    return width !== null && width <= 160;
  });
  return asString((small ?? images[images.length - 1]).url);
}

export function parseAlbum(value: unknown): ParsedAlbum | null {
  const record = asRecord(value);
  const spotifyId = asString(record?.id);
  const name = asString(record?.name);
  if (!record || !spotifyId || !name) return null;
  const releaseDate = asString(record.release_date);
  return {
    spotifyId,
    name,
    releaseDate,
    releaseYear: releaseYearFromDate(releaseDate),
    albumType: asString(record.album_type),
    imageUrl: pickImage(record.images),
    totalTracks: asNumber(record.total_tracks),
  };
}

export function parseTrack(value: unknown, albumFallback?: ParsedAlbum | null): ParsedTrack | null {
  const record = asRecord(value);
  if (!record) return null;
  if (record.is_local === true) return null;
  const type = asString(record.type);
  if (type && type !== "track") return null;
  const spotifyId = asString(record.id);
  if (!spotifyId) return null;
  const name = asString(record.name) ?? "Untitled";
  const uri = asString(record.uri) ?? `spotify:track:${spotifyId}`;
  if (!uri.includes(":track:")) return null;
  const external = asRecord(record.external_ids);
  const isrc = asString(external?.isrc)?.toUpperCase() ?? null;
  const album = parseAlbum(record.album) ?? albumFallback ?? null;
  return {
    spotifyId,
    uri,
    name,
    isrc,
    durationMs: asNumber(record.duration_ms) ?? 0,
    explicit: record.explicit === true,
    popularity: asNumber(record.popularity),
    discNumber: asNumber(record.disc_number),
    trackNumber: asNumber(record.track_number),
    artists: parseArtists(record.artists),
    album,
  };
}

/** Liked songs, playlist items (`item` or legacy `track`), and bare album tracks. */
export function parseLibraryItem(
  value: unknown,
  albumFallback?: ParsedAlbum | null,
  addedAtFallback?: string | null,
): ParsedLibraryItem | null {
  const record = asRecord(value);
  if (!record) return null;
  const nested = asRecord(record.item) ?? (record.track !== undefined ? asRecord(record.track) : null);
  const addedAt = asString(record.added_at) ?? addedAtFallback ?? null;
  if (record.item !== undefined || record.track !== undefined) {
    const track = parseTrack(nested, albumFallback);
    return track ? { track, addedAt } : null;
  }
  const track = parseTrack(record, albumFallback);
  return track ? { track, addedAt } : null;
}

export type SpotifyPage = {
  items: unknown[];
  next: string | null;
  total: number | null;
  limit: number;
  offset: number;
};

export function parsePage(value: unknown): SpotifyPage {
  const record = asRecord(value) ?? {};
  return {
    items: Array.isArray(record.items) ? record.items : [],
    next: typeof record.next === "string" ? record.next : null,
    total: asNumber(record.total),
    limit: asNumber(record.limit) ?? 50,
    offset: asNumber(record.offset) ?? 0,
  };
}

export function playlistTrackTotal(value: unknown) {
  const record = asRecord(value);
  const items = asRecord(record?.items);
  const tracks = asRecord(record?.tracks);
  return asNumber(items?.total) ?? asNumber(tracks?.total);
}
