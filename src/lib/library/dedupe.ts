import { nameArtistKey } from "./normalize";

export type IncomingIdentity = {
  uri: string;
  spotifyId: string;
  name: string;
  isrc?: string | null;
  primaryArtist: string;
};

export type DedupeMatch = {
  trackId: string;
  via: "uri" | "isrc" | "name";
};

export type DedupeIndex = {
  byUri: Map<string, string>;
  byIsrc: Map<string, string>;
  byNameArtist: Map<string, string>;
};

export function emptyIndex(): DedupeIndex {
  return {
    byUri: new Map(),
    byIsrc: new Map(),
    byNameArtist: new Map(),
  };
}

export function dedupeKeyFor(input: { isrc?: string | null; name: string; primaryArtist: string }) {
  const isrc = input.isrc?.trim();
  if (isrc) return `isrc:${isrc.toUpperCase()}`;
  return `na:${nameArtistKey(input.name, input.primaryArtist)}`;
}

export function remember(index: DedupeIndex, trackId: string, input: IncomingIdentity) {
  if (input.uri) index.byUri.set(input.uri, trackId);
  const isrc = input.isrc?.trim();
  if (isrc) index.byIsrc.set(isrc.toUpperCase(), trackId);
  const key = nameArtistKey(input.name, input.primaryArtist);
  if (key !== "|") index.byNameArtist.set(key, trackId);
}

export function retarget(index: DedupeIndex, fromId: string, toId: string) {
  for (const map of [index.byUri, index.byIsrc, index.byNameArtist]) {
    for (const [key, id] of map) {
      if (id === fromId) map.set(key, toId);
    }
  }
}

/**
 * Same song across liked songs, playlists, and albums.
 * Spotify URI first, then ISRC, then normalized title + primary artist.
 */
export function matchTrack(index: DedupeIndex, input: IncomingIdentity): DedupeMatch | null {
  if (input.uri) {
    const byUri = index.byUri.get(input.uri);
    if (byUri) return { trackId: byUri, via: "uri" };
  }
  const isrc = input.isrc?.trim().toUpperCase();
  if (isrc) {
    const byIsrc = index.byIsrc.get(isrc);
    if (byIsrc) return { trackId: byIsrc, via: "isrc" };
  }
  const key = nameArtistKey(input.name, input.primaryArtist);
  if (key !== "|") {
    const byName = index.byNameArtist.get(key);
    if (byName) return { trackId: byName, via: "name" };
  }
  return null;
}
