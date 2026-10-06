import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  spotifyId: text("spotify_id").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  imageUrl: text("image_url"),
  refreshTokenEnc: text("refresh_token_enc"),
  accessTokenEnc: text("access_token_enc"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  isDev: boolean("is_dev").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const artists = pgTable(
  "artists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyId: text("spotify_id").notNull(),
    name: text("name").notNull(),
    genres: text("genres").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("artists_user_spotify").on(table.userId, table.spotifyId)],
);

export const albums = pgTable(
  "albums",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyId: text("spotify_id").notNull(),
    name: text("name").notNull(),
    releaseDate: text("release_date"),
    releaseYear: integer("release_year"),
    albumType: text("album_type"),
    imageUrl: text("image_url"),
    totalTracks: integer("total_tracks"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("albums_user_spotify").on(table.userId, table.spotifyId)],
);

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyId: text("spotify_id").notNull(),
    uri: text("uri").notNull(),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    primaryArtistKey: text("primary_artist_key").notNull(),
    isrc: text("isrc"),
    dedupeKey: text("dedupe_key").notNull(),
    durationMs: integer("duration_ms").notNull().default(0),
    explicit: boolean("explicit").notNull().default(false),
    popularity: integer("popularity"),
    discNumber: integer("disc_number"),
    trackNumber: integer("track_number"),
    albumId: uuid("album_id").references(() => albums.id, { onDelete: "set null" }),
    releaseYear: integer("release_year"),
    searchText: text("search_text").notNull().default(""),
    canonicalRank: integer("canonical_rank").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tracks_user_dedupe").on(table.userId, table.dedupeKey),
    index("tracks_user_year_idx").on(table.userId, table.releaseYear),
  ],
);

export const trackAliases = pgTable(
  "track_aliases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    spotifyId: text("spotify_id").notNull(),
    uri: text("uri").notNull(),
    isrc: text("isrc"),
  },
  (table) => [unique("track_aliases_user_uri").on(table.userId, table.uri)],
);

export const trackArtists = pgTable(
  "track_artists",
  {
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "cascade" }),
    artistId: uuid("artist_id")
      .notNull()
      .references(() => artists.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trackId, table.artistId] })],
);

export const playlists = pgTable(
  "playlists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    spotifyId: text("spotify_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    ownerSpotifyId: text("owner_spotify_id"),
    ownerName: text("owner_name"),
    collaborative: boolean("collaborative").notNull().default(false),
    isPublic: boolean("is_public"),
    snapshotId: text("snapshot_id"),
    trackCount: integer("track_count"),
    tracksUnavailable: boolean("tracks_unavailable").notNull().default(false),
    unavailableReason: text("unavailable_reason"),
    imageUrl: text("image_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("playlists_user_spotify").on(table.userId, table.spotifyId)],
);

export const trackSources = pgTable("track_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  trackId: uuid("track_id")
    .notNull()
    .references(() => tracks.id, { onDelete: "cascade" }),
  sourceType: text("source_type").notNull(),
  playlistId: uuid("playlist_id").references(() => playlists.id, { onDelete: "cascade" }),
  albumId: uuid("album_id").references(() => albums.id, { onDelete: "cascade" }),
  addedAt: timestamp("added_at", { withTimezone: true }),
  seenRunId: uuid("seen_run_id"),
});

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  phase: text("phase").notNull().default("liked"),
  cursor: jsonb("cursor").notNull().default({}),
  progress: jsonb("progress").notNull().default({}),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  proposalIds: uuid("proposal_ids").array().notNull().default([]),
  usage: jsonb("usage"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const playlistProposals = pgTable("playlist_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  trackIds: uuid("track_ids").array().notNull(),
  status: text("status").notNull().default("proposed"),
  spotifyPlaylistId: text("spotify_playlist_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  savedAt: timestamp("saved_at", { withTimezone: true }),
});

export const tokenUsageLog = pgTable("token_usage_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens").notNull(),
  completionTokens: integer("completion_tokens").notNull(),
  estimatedCostUsd: doublePrecision("estimated_cost_usd").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
