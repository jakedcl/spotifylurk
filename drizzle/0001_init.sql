CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spotify_id text NOT NULL UNIQUE,
  display_name text NOT NULL,
  email text,
  image_url text,
  refresh_token_enc text,
  access_token_enc text,
  access_token_expires_at timestamptz,
  is_dev boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  name text NOT NULL,
  genres text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_id)
);

CREATE INDEX artists_user_name_idx ON artists (user_id, name);

CREATE TABLE albums (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  name text NOT NULL,
  release_date text,
  release_year integer,
  album_type text,
  image_url text,
  total_tracks integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_id)
);

CREATE TABLE tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  uri text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  primary_artist_key text NOT NULL,
  isrc text,
  dedupe_key text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  explicit boolean NOT NULL DEFAULT false,
  popularity integer,
  disc_number integer,
  track_number integer,
  album_id uuid REFERENCES albums (id) ON DELETE SET NULL,
  release_year integer,
  search_text text NOT NULL DEFAULT '',
  canonical_rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX tracks_user_year_idx ON tracks (user_id, release_year);
CREATE INDEX tracks_user_isrc_idx ON tracks (user_id, isrc) WHERE isrc IS NOT NULL;
CREATE INDEX tracks_search_trgm_idx ON tracks USING gin (search_text gin_trgm_ops);

CREATE TABLE track_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  uri text NOT NULL,
  isrc text,
  UNIQUE (user_id, uri)
);

CREATE INDEX track_aliases_track_idx ON track_aliases (track_id);

CREATE TABLE track_artists (
  track_id uuid NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (track_id, artist_id)
);

CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  spotify_id text NOT NULL,
  name text NOT NULL,
  description text,
  owner_spotify_id text,
  owner_name text,
  collaborative boolean NOT NULL DEFAULT false,
  is_public boolean,
  snapshot_id text,
  track_count integer,
  tracks_unavailable boolean NOT NULL DEFAULT false,
  unavailable_reason text,
  image_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, spotify_id)
);

CREATE TABLE track_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES tracks (id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('liked', 'playlist', 'album')),
  playlist_id uuid REFERENCES playlists (id) ON DELETE CASCADE,
  album_id uuid REFERENCES albums (id) ON DELETE CASCADE,
  added_at timestamptz,
  seen_run_id uuid,
  CONSTRAINT track_sources_shape CHECK (
    (source_type = 'liked' AND playlist_id IS NULL AND album_id IS NULL)
    OR (source_type = 'playlist' AND playlist_id IS NOT NULL AND album_id IS NULL)
    OR (source_type = 'album' AND album_id IS NOT NULL AND playlist_id IS NULL)
  ),
  CONSTRAINT track_sources_identity UNIQUE NULLS NOT DISTINCT (user_id, track_id, source_type, playlist_id, album_id)
);

CREATE INDEX track_sources_user_type_idx ON track_sources (user_id, source_type);
CREATE INDEX track_sources_track_idx ON track_sources (track_id);
CREATE INDEX track_sources_playlist_idx ON track_sources (playlist_id);
CREATE INDEX track_sources_added_idx ON track_sources (user_id, added_at);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('running', 'done', 'error')),
  phase text NOT NULL DEFAULT 'liked',
  cursor jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sync_runs_user_idx ON sync_runs (user_id, started_at DESC);

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  proposal_ids uuid[] NOT NULL DEFAULT '{}',
  usage jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX chat_messages_user_idx ON chat_messages (user_id, created_at);

CREATE TABLE playlist_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  track_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'saved', 'failed')),
  spotify_playlist_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  saved_at timestamptz
);

CREATE INDEX playlist_proposals_user_idx ON playlist_proposals (user_id, created_at);

CREATE TABLE token_usage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  model text NOT NULL,
  prompt_tokens integer NOT NULL,
  completion_tokens integer NOT NULL,
  estimated_cost_usd double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX token_usage_log_user_idx ON token_usage_log (user_id, created_at DESC);
