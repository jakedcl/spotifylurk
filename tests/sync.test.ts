import { describe, expect, it } from "vitest";
import { getPool } from "../src/db";
import { queryLibrary } from "../src/lib/library/query";
import { SpotifyClient } from "../src/lib/spotify/client";
import { runSyncStep, startSync } from "../src/lib/spotify/sync";
import { insertUser } from "./helpers";

function page(items: unknown[], total = items.length, offset = 0) {
  return { items, total, limit: 50, offset, next: null as string | null, href: "", previous: null };
}

function track(partial: Record<string, unknown>) {
  return {
    type: "track",
    popularity: null,
    explicit: false,
    duration_ms: 200000,
    disc_number: 1,
    track_number: 1,
    is_local: false,
    external_ids: {},
    album: {
      id: "alb-week",
      name: "Weeknights",
      album_type: "album",
      release_date: "2019-04-01",
      total_tracks: 8,
      images: [],
      artists: [{ id: "art-mina", name: "Mina Voss" }],
    },
    artists: [{ id: "art-mina", name: "Mina Voss" }],
    ...partial,
  };
}

describe("library sync", () => {
  it("dedupes songs, records a 403 playlist, and falls back to /tracks", async () => {
    const userId = await insertUser("me-user", "Me");
    const calls: string[] = [];
    let likedHits = 0;
    let nightBusHits = 0;

    const liked = page([
      {
        added_at: "2021-04-02T00:00:00Z",
        track: track({
          id: "aaa",
          uri: "spotify:track:aaa",
          name: "Silver Line",
          external_ids: { isrc: "USAAA1111111" },
        }),
      },
      {
        added_at: "2020-01-01T00:00:00Z",
        track: track({
          id: "bbb",
          uri: "spotify:track:bbb",
          name: "Loud Enough",
          explicit: true,
          artists: [{ id: "art-north", name: "North Annex" }],
          album: {
            id: "alb-loud",
            name: "Annex",
            album_type: "album",
            release_date: "2018",
            total_tracks: 4,
            images: [],
            artists: [{ id: "art-north", name: "North Annex" }],
          },
        }),
      },
      { added_at: "2020-01-01T00:00:00Z", track: null },
      { added_at: "2020-01-01T00:00:00Z", track: { type: "episode", id: "ep1", name: "Show", uri: "spotify:episode:ep1" } },
      { added_at: "2020-01-01T00:00:00Z", track: { type: "track", is_local: true, name: "Local file", uri: "spotify:local:x" } },
    ]);

    const client = new SpotifyClient({
      sleep: async () => undefined,
      getAccessToken: async () => "token",
      refreshAccessToken: async () => "token",
      fetch: async (input) => {
        const url = new URL(String(input));
        const path = `${url.pathname}${url.search}`;
        calls.push(url.pathname);
        if (url.pathname === "/v1/me/tracks") {
          likedHits += 1;
          if (likedHits === 1) return new Response("{}", { status: 429, headers: { "retry-after": "0" } });
          return Response.json(liked);
        }
        if (url.pathname === "/v1/me/playlists") {
          return Response.json(
            page([
              {
                id: "pl-night",
                name: "Night bus",
                snapshot_id: "snap1",
                collaborative: false,
                public: false,
                owner: { id: "me-user", display_name: "Me" },
                items: { total: 3 },
              },
              {
                id: "pl-friend",
                name: "A friend's mix",
                snapshot_id: "snap2",
                collaborative: false,
                public: true,
                owner: { id: "someone-else", display_name: "Friend" },
                items: { total: 40 },
              },
              {
                id: "pl-legacy",
                name: "Old shape",
                snapshot_id: "snap3",
                collaborative: false,
                owner: { id: "me-user", display_name: "Me" },
                tracks: { total: 1 },
              },
              {
                id: "pl-locked",
                name: "Locked",
                snapshot_id: "snap4",
                collaborative: false,
                owner: { id: "me-user", display_name: "Me" },
                items: { total: 4 },
              },
            ]),
          );
        }
        if (url.pathname === "/v1/playlists/pl-night/items") {
          nightBusHits += 1;
          return Response.json(
            page([
              {
                added_at: "2021-01-15T00:00:00Z",
                item: track({ id: "aaa", uri: "spotify:track:aaa", name: "Silver Line", external_ids: { isrc: "USAAA1111111" } }),
              },
              {
                added_at: "2022-02-02T00:00:00Z",
                item: track({ id: "ccc", uri: "spotify:track:ccc", name: "Silver Line (Remastered)", external_ids: {} }),
              },
              {
                added_at: "2019-06-01T00:00:00Z",
                item: track({
                  id: "ddd",
                  uri: "spotify:track:ddd",
                  name: "Glass Door",
                  artists: [{ id: "art-field", name: "Field Glass" }],
                  album: {
                    id: "alb-glass",
                    name: "Pane",
                    album_type: "album",
                    release_date: "1974",
                    total_tracks: 9,
                    images: [],
                    artists: [{ id: "art-field", name: "Field Glass" }],
                  },
                }),
              },
            ]),
          );
        }
        if (url.pathname === "/v1/playlists/pl-legacy/items") return new Response("missing", { status: 404 });
        if (url.pathname === "/v1/playlists/pl-legacy/tracks") {
          return Response.json(
            page([
              {
                added_at: "2018-03-03T00:00:00Z",
                track: track({
                  id: "eee",
                  uri: "spotify:track:eee",
                  name: "Paper Boat",
                  artists: [{ id: "art-kite", name: "Kite Year" }],
                  album: {
                    id: "alb-paper",
                    name: "Fold",
                    album_type: "album",
                    release_date: "2016-08-01",
                    total_tracks: 6,
                    images: [],
                    artists: [{ id: "art-kite", name: "Kite Year" }],
                  },
                }),
              },
            ]),
          );
        }
        if (url.pathname === "/v1/playlists/pl-locked/items" || url.pathname === "/v1/playlists/pl-locked/tracks") {
          return new Response("nope", { status: 403 });
        }
        if (url.pathname === "/v1/me/albums") {
          return Response.json(
            page([
              {
                added_at: "2010-05-01T00:00:00Z",
                album: {
                  id: "alb-unplayed",
                  name: "Unplayed sides",
                  album_type: "album",
                  release_date: "2001",
                  total_tracks: 1,
                  images: [{ url: "https://i.scdn.co/image/unplayed", width: 64, height: 64 }],
                  artists: [{ id: "art-field", name: "Field Glass" }],
                  tracks: {
                    items: [
                      {
                        type: "track",
                        id: "fff",
                        uri: "spotify:track:fff",
                        name: "Side B",
                        explicit: false,
                        duration_ms: 210000,
                        track_number: 1,
                        disc_number: 1,
                        artists: [{ id: "art-field", name: "Field Glass" }],
                        external_ids: { isrc: "USFFF0000001" },
                        popularity: null,
                      },
                    ],
                    next: null,
                    total: 1,
                    limit: 50,
                    offset: 0,
                  },
                },
              },
              {
                added_at: "2010-06-01T00:00:00Z",
                album: {
                  id: "alb-shared",
                  name: "Shared room",
                  album_type: "album",
                  release_date: "2019-06-01",
                  total_tracks: 2,
                  images: [],
                  artists: [{ id: "art-mina", name: "Mina Voss" }],
                  tracks: {
                    items: [
                      {
                        type: "track",
                        id: "aa2",
                        uri: "spotify:track:aa2",
                        name: "Silver Line",
                        explicit: false,
                        duration_ms: 200000,
                        artists: [{ id: "art-mina", name: "Mina Voss" }],
                        external_ids: { isrc: "USAAA1111111" },
                        popularity: null,
                      },
                    ],
                    next: "https://api.spotify.com/v1/albums/alb-shared/tracks?offset=1&limit=50",
                    total: 2,
                    limit: 1,
                    offset: 0,
                  },
                },
              },
            ]),
          );
        }
        if (url.pathname === "/v1/albums/alb-shared/tracks") {
          return Response.json(
            page(
              [
                {
                  type: "track",
                  id: "ggg",
                  uri: "spotify:track:ggg",
                  name: "Extra side",
                  explicit: false,
                  duration_ms: 180000,
                  artists: [{ id: "art-field", name: "Field Glass" }],
                  external_ids: {},
                  popularity: null,
                },
              ],
              2,
              1,
            ),
          );
        }
        throw new Error(`unexpected ${path}`);
      },
    });

    async function finish() {
      await startSync(userId);
      let status = "running";
      for (let guard = 0; status === "running" && guard < 20; guard += 1) {
        const result = await runSyncStep({
          userId,
          spotifyUserId: "me-user",
          client,
          maxPages: 6,
          deadlineMs: 20_000,
        });
        status = result.status;
        expect(result.retryAfter).toBeNull();
        if (status === "error") throw new Error(result.error ?? "sync failed");
      }
      expect(status).toBe("done");
    }

    await finish();
    expect(likedHits).toBeGreaterThan(1);
    expect(calls.some((path) => path.includes("pl-friend"))).toBe(false);

    const added = await queryLibrary(userId, { ...baseFilters(), view: "added" }, { limit: 50, offset: 0 });
    const albumOnly = await queryLibrary(userId, { ...baseFilters(), view: "album" }, { limit: 50, offset: 0 });
    expect(added.rows.map((row) => row.name).sort()).toEqual(["Glass Door", "Loud Enough", "Paper Boat", "Silver Line"]);
    expect(albumOnly.rows.map((row) => row.name).sort()).toEqual(["Extra side", "Side B"]);

    const silver = added.rows.find((row) => row.name === "Silver Line");
    expect(silver?.addedAt?.slice(0, 10)).toBe("2021-01-15");
    expect(silver?.sources.map((source) => source.label).sort()).toEqual(["Album", "Liked", "Night bus"]);
    expect(added.rows.find((row) => row.name === "Loud Enough")?.explicit).toBe(true);
    expect(added.rows.find((row) => row.name === "Glass Door")?.year).toBe(1974);

    const playlists = await getPool().query<{ name: string; tracks_unavailable: boolean }>(
      `SELECT name, tracks_unavailable FROM playlists WHERE user_id = $1 ORDER BY name`,
      [userId],
    );
    const unavailable = playlists.rows.filter((row) => row.tracks_unavailable).map((row) => row.name);
    expect(unavailable.sort()).toEqual(["A friend's mix", "Locked"]);

    const other = await insertUser("other-user", "Other");
    await getPool().query(
      `INSERT INTO tracks (user_id, spotify_id, uri, name, normalized_name, primary_artist_key, dedupe_key, search_text)
       VALUES ($1, 'secret', 'spotify:track:secret', 'Secret song', 'secret song', 'other', 'na:secret song|other', 'secret song')`,
      [other],
    );
    const isolated = await queryLibrary(userId, { ...baseFilters(), view: "all", q: "secret" }, { limit: 20, offset: 0 });
    expect(isolated.total).toBe(0);

    await finish();
    expect(nightBusHits).toBe(1);
    const again = await queryLibrary(userId, { ...baseFilters(), view: "added" }, { limit: 50, offset: 0 });
    expect(again.total).toBe(4);
  });
});

function baseFilters() {
  return {
    view: "added" as const,
    q: "",
    artist: "",
    yearFrom: null,
    yearTo: null,
    decade: null,
    source: null,
    playlistId: null,
    playlistName: null,
    addedFrom: null,
    addedTo: null,
    addedYear: null,
    explicit: null,
    genre: null,
    sort: "name" as const,
    dir: "asc" as const,
  };
}
