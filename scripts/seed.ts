import { loadEnv } from "./load-env";

loadEnv();

type Artist = { spotifyId: string; name: string };

const artists: Artist[] = [
  { spotifyId: "art-mina", name: "Mina Voss" },
  { spotifyId: "art-red", name: "The Redweek" },
  { spotifyId: "art-harlow", name: "Harlow Bend" },
  { spotifyId: "art-june", name: "June Static" },
  { spotifyId: "art-patio", name: "Patio Lights" },
  { spotifyId: "art-north", name: "North Annex" },
  { spotifyId: "art-field", name: "Field Glass" },
  { spotifyId: "art-soft", name: "Soft Radio" },
  { spotifyId: "art-kite", name: "Kite Year" },
  { spotifyId: "art-marlow", name: "Marlow & Pine" },
  { spotifyId: "art-silt", name: "Silt" },
  { spotifyId: "art-ada", name: "Ada Moss" },
];

const left = ["Silver", "Cold", "Late", "Paper", "Quiet", "Yellow", "Low", "Glass", "Harbor", "Static", "Wool", "Amber"];
const right = ["Line", "Room", "Window", "Radio", "Stairs", "Hour", "Letter", "Coat", "Market", "Light", "Bus", "Field"];

function album(spotifyId: string, name: string, year: number, artist: Artist) {
  return {
    spotifyId,
    name,
    releaseDate: `${year}-01-01`,
    releaseYear: year,
    albumType: "album",
    imageUrl: null,
    totalTracks: 10,
    artists: [artist],
  };
}

async function main() {
  const { getPool, closeDb } = await import("../src/db");
  const { emptyIndex } = await import("../src/lib/library/dedupe");
  const { persistTracks } = await import("../src/lib/library/persist");
  const pool = getPool();
  await pool.query(`DELETE FROM users WHERE spotify_id = 'dev-sample'`);
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (spotify_id, display_name, is_dev) VALUES ('dev-sample', 'Sample listener', true) RETURNING id`,
  );
  const userId = user.rows[0].id;
  const playlist = async (spotifyId: string, name: string, extra: { unavailable?: boolean; reason?: string } = {}) => {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO playlists (user_id, spotify_id, name, tracks_unavailable, unavailable_reason, owner_name)
       VALUES ($1, $2, $3, $4, $5, 'Sample listener') RETURNING id`,
      [userId, spotifyId, name, extra.unavailable ?? false, extra.reason ?? null],
    );
    return row.rows[0].id;
  };
  const kitchen = await playlist("pl-kitchen", "Kitchen 2021");
  const parents = await playlist("pl-parents", "Parents' shelf");
  const night = await playlist("pl-night", "Night bus");
  await playlist("pl-friend", "A friend's mix", {
    unavailable: true,
    reason: "Spotify only returns tracks for playlists you own or collaborate on. Followed playlists are listed without their songs.",
  });

  const items: Parameters<typeof persistTracks>[3] = [];
  for (let i = 0; i < 120; i += 1) {
    const artist = artists[i % artists.length];
    const year = 1968 + (i % 56);
    const name = `${left[i % left.length]} ${right[Math.floor(i / left.length) % right.length]}`;
    const addedYear = artist.spotifyId === "art-mina" ? 2021 : 2016 + (i % 10);
    const addedMonth = String((i % 12) + 1).padStart(2, "0");
    const addedAt = `${addedYear}-${addedMonth}-15T12:00:00Z`;
    const parsed = {
      spotifyId: `gen-${i}`,
      uri: `spotify:track:gen-${i}`,
      name,
      isrc: i % 17 === 0 ? `USPILE${String(i).padStart(7, "0")}` : null,
      durationMs: 160000 + (i % 90) * 1000,
      explicit: artist.spotifyId === "art-north" && i % 2 === 0,
      popularity: null,
      discNumber: 1,
      trackNumber: (i % 10) + 1,
      artists: [artist],
      album: album(`alb-${artist.spotifyId}`, `${artist.name} — recorded`, year, artist),
    };
    const liked = i % 3 !== 1;
    const onNight = i % 4 === 0;
    const onKitchen = artist.spotifyId === "art-mina" || i % 5 === 0;
    if (liked) items.push({ track: parsed, sourceType: "liked", playlistId: null, addedAt });
    if (onKitchen) items.push({ track: parsed, sourceType: "playlist", playlistId: kitchen, addedAt });
    if (onNight) items.push({ track: parsed, sourceType: "playlist", playlistId: night, addedAt });
    if (year >= 1970 && year <= 1979) {
      items.push({ track: parsed, sourceType: "playlist", playlistId: parents, addedAt: "2017-04-01T00:00:00Z" });
    }
    if (!liked && !onNight && !onKitchen && !(year >= 1970 && year <= 1979)) {
      items.push({ track: parsed, sourceType: "album", playlistId: null, addedAt });
    }
  }

  const field = artists.find((artist) => artist.spotifyId === "art-field")!;
  for (let i = 0; i < 8; i += 1) {
    items.push({
      track: {
        spotifyId: `unplayed-${i}`,
        uri: `spotify:track:unplayed-${i}`,
        name: `Side ${String.fromCharCode(66 + i)}`,
        isrc: null,
        durationMs: 190000 + i * 4000,
        explicit: false,
        popularity: null,
        discNumber: 1,
        trackNumber: i + 1,
        artists: [field],
        album: album("alb-unplayed", "Unplayed sides", 2004, field),
      },
      sourceType: "album",
      playlistId: null,
      addedAt: "2014-11-02T00:00:00Z",
    });
  }

  const mina = artists[0];
  items.push(
    {
      track: {
        spotifyId: "cold-a",
        uri: "spotify:track:cold-a",
        name: "Cold Kitchen",
        isrc: "USPILE000COLD",
        durationMs: 214000,
        explicit: false,
        popularity: null,
        discNumber: 1,
        trackNumber: 1,
        artists: [mina],
        album: album("alb-cold", "Weeknights", 2019, mina),
      },
      sourceType: "liked",
      playlistId: null,
      addedAt: "2021-03-18T00:00:00Z",
    },
    {
      track: {
        spotifyId: "cold-b",
        uri: "spotify:track:cold-b",
        name: "Cold Kitchen",
        isrc: "USPILE000COLD",
        durationMs: 214000,
        explicit: false,
        popularity: null,
        discNumber: 1,
        trackNumber: 1,
        artists: [mina],
        album: album("alb-cold-deluxe", "Weeknights deluxe", 2019, mina),
      },
      sourceType: "playlist",
      playlistId: night,
      addedAt: "2021-11-02T00:00:00Z",
    },
    {
      track: {
        spotifyId: "cold-c",
        uri: "spotify:track:cold-c",
        name: "Cold Kitchen (Remastered)",
        isrc: null,
        durationMs: 216000,
        explicit: false,
        popularity: null,
        discNumber: 1,
        trackNumber: 1,
        artists: [mina],
        album: album("alb-cold-rem", "Weeknights remaster", 2024, mina),
      },
      sourceType: "playlist",
      playlistId: kitchen,
      addedAt: "2024-01-09T00:00:00Z",
    },
  );

  const index = emptyIndex();
  for (let i = 0; i < items.length; i += 80) {
    await persistTracks(userId, "00000000-0000-4000-8000-0000000000aa", index, items.slice(i, i + 80));
  }
  const counts = await pool.query<{ songs: string; album_only: string }>(
    `SELECT
       (SELECT count(*) FROM tracks WHERE user_id = $1) AS songs,
       (SELECT count(*) FROM tracks t WHERE t.user_id = $1
         AND NOT EXISTS (SELECT 1 FROM track_sources s WHERE s.track_id = t.id AND s.source_type IN ('liked', 'playlist'))
       ) AS album_only`,
    [userId],
  );
  console.log(`Seeded sample listener with ${counts.rows[0].songs} songs (${counts.rows[0].album_only} album-only).`);
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
