import { describe, expect, it } from "vitest";
import { getPool } from "../src/db";
import { runChat } from "../src/lib/ai/chat";
import type { LlmClient, LlmMessage } from "../src/lib/ai/openai";
import { executeTool } from "../src/lib/ai/tools";
import { emptyIndex } from "../src/lib/library/dedupe";
import { persistTracks } from "../src/lib/library/persist";
import { estimateCostUsd } from "../src/lib/ai/pricing";
import { fakeTrack, insertUser } from "./helpers";

async function seedLibrary(userId: string) {
  const playlist = await getPool().query<{ id: string }>(
    `INSERT INTO playlists (user_id, spotify_id, name) VALUES ($1, 'pl-parents', 'Parents'' shelf') RETURNING id`,
    [userId],
  );
  const parents = playlist.rows[0].id;
  const mina = { spotifyId: "art-mina", name: "Mina Voss" };
  const silt = { spotifyId: "art-silt", name: "Silt" };
  const low = { spotifyId: "art-low", name: "Low Ceiling" };
  const index = emptyIndex();
  const album = (id: string, name: string, year: number) => ({
    spotifyId: id,
    name,
    releaseDate: String(year),
    releaseYear: year,
    albumType: "album",
    imageUrl: null,
    totalTracks: 4,
  });
  await persistTracks(userId, "00000000-0000-4000-8000-000000000001", index, [
    ...["North Window", "Late Radio", "Kitchen Coat"].map((name, i) => ({
      track: fakeTrack({
        spotifyId: `mina-${i}`,
        name,
        artists: [mina],
        explicit: false,
        durationMs: 200000,
        album: album("alb-mina", "Weeknights", 2019),
      }),
      sourceType: "liked" as const,
      playlistId: null,
      addedAt: `2021-0${i + 1}-10T00:00:00Z`,
    })),
    {
      track: fakeTrack({
        spotifyId: "silt-1",
        name: "Harbor Light",
        artists: [silt],
        album: album("alb-silt", "Silt", 2020),
      }),
      sourceType: "liked",
      playlistId: null,
      addedAt: "2021-08-01T00:00:00Z",
    },
    {
      track: fakeTrack({
        spotifyId: "loud-1",
        name: "Too Loud",
        explicit: true,
        artists: [{ spotifyId: "art-north", name: "North Annex" }],
        album: album("alb-loud", "Annex", 2018),
      }),
      sourceType: "liked",
      playlistId: null,
      addedAt: "2022-01-01T00:00:00Z",
    },
    ...["Pane", "Amber Stairs", "Wool Radio"].map((name, i) => ({
      track: fakeTrack({
        spotifyId: `seventies-${i}`,
        name,
        artists: [low],
        album: album("alb-70s", "Old room", 1972 + i),
        durationMs: 180000,
      }),
      sourceType: "playlist" as const,
      playlistId: parents,
      addedAt: "2018-01-01T00:00:00Z",
    })),
    {
      track: fakeTrack({
        spotifyId: "album-only",
        name: "Side B",
        artists: [{ spotifyId: "art-field", name: "Field Glass" }],
        album: album("alb-only", "Unplayed sides", 2004),
      }),
      sourceType: "album",
      playlistId: null,
      addedAt: "2015-01-01T00:00:00Z",
    },
    {
      track: fakeTrack({
        spotifyId: "nineties-1",
        name: "Soft Market",
        artists: [{ spotifyId: "art-june", name: "June Static" }],
        album: album("alb-90s", "Dial", 1994),
        explicit: false,
        durationMs: 240000,
      }),
      sourceType: "liked",
      playlistId: null,
      addedAt: "2020-05-05T00:00:00Z",
    },
  ]);
  return parents;
}

describe("AI tools", () => {
  it("answers from the database and rejects songs outside the library", async () => {
    const userId = await insertUser("listener", "Listener");
    const otherId = await insertUser("intruder", "Intruder");
    await seedLibrary(userId);
    await persistTracks(otherId, "00000000-0000-4000-8000-000000000002", emptyIndex(), [
      {
        track: fakeTrack({ spotifyId: "foreign", name: "Not yours", artists: [{ spotifyId: "art-x", name: "X" }] }),
        sourceType: "liked",
        playlistId: null,
        addedAt: "2021-01-01T00:00:00Z",
      },
    ]);
    const foreign = await getPool().query<{ id: string }>(`SELECT id FROM tracks WHERE user_id = $1`, [otherId]);

    const stats = await executeTool(userId, "library_stats", { group_by: "artist", added_year: 2021, source_scope: "added" });
    const rows = (stats.forModel as { rows: { label: string; count: number }[] }).rows;
    expect(rows[0]).toMatchObject({ label: "Mina Voss", count: 3 });
    expect(rows.some((row) => row.label === "X")).toBe(false);

    const playlists = await executeTool(userId, "library_stats", { group_by: "playlist", decade: 1970 });
    expect((playlists.forModel as { rows: { label: string; count: number }[] }).rows[0]).toMatchObject({
      label: "Parents' shelf",
      count: 3,
    });

    const clean = await executeTool(userId, "search_songs", {
      explicit: false,
      release_year_from: 1990,
      release_year_to: 1999,
      source_scope: "added",
    });
    const songs = (clean.forModel as { songs: { name: string; explicit: boolean }[] }).songs;
    expect(songs.map((song) => song.name)).toContain("Soft Market");
    expect(songs.every((song) => song.explicit === false)).toBe(true);

    const genre = await executeTool(userId, "search_songs", { genre: "rap" });
    expect((genre.forModel as { warning?: string }).warning).toMatch(/genre/i);
    expect((genre.forModel as { songs: unknown[] }).songs).toEqual([]);

    const rejected = await executeTool(userId, "propose_playlist", {
      name: "Stolen",
      track_ids: [foreign.rows[0].id],
    });
    expect((rejected.forModel as { error: string }).error).toMatch(/Unknown/);
    expect(rejected.proposal).toBeUndefined();

    const found = await executeTool(userId, "search_songs", { artist: "Mina Voss", limit: 10 });
    const ids = (found.forModel as { songs: { id: string }[] }).songs.map((song) => song.id);
    let seenTool = false;
    const client: LlmClient = {
      async complete({ messages }) {
        const last = messages[messages.length - 1] as LlmMessage;
        if (!seenTool) {
          seenTool = true;
          return {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call-1",
                  type: "function",
                  function: {
                    name: "propose_playlist",
                    arguments: JSON.stringify({ name: "Mina at home", track_ids: ids.slice(0, 2), description: "From 2021" }),
                  },
                },
              ],
            },
            usage: { prompt_tokens: 120, completion_tokens: 30 },
          };
        }
        expect(last.role).toBe("tool");
        expect(last.content).toContain("proposal_id");
        return {
          message: { role: "assistant", content: "Drafted Mina at home from songs you saved." },
          usage: { prompt_tokens: 80, completion_tokens: 20 },
        };
      },
    };

    const chat = await runChat({
      userId,
      model: "gpt-4o-mini",
      client,
      history: [],
      userMessage: "Make a short playlist of Mina Voss",
    });
    expect(chat.content).toMatch(/Mina at home/);
    expect(chat.proposals).toHaveLength(1);
    expect(chat.proposals[0].trackCount).toBe(2);
    expect(chat.usage.promptTokens).toBe(200);
    expect(chat.usage.estimatedCostUsd).toBeCloseTo(estimateCostUsd("gpt-4o-mini", 200, 50), 8);
    const stored = await getPool().query(`SELECT name FROM playlist_proposals WHERE user_id = $1`, [userId]);
    expect(stored.rows[0].name).toBe("Mina at home");
  });
});
