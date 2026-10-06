# Pile

Every song you saved, in one list. Pile signs in with Spotify, pulls liked songs, playlist tracks, and tracks from saved albums, and lets you filter that library or ask questions about it.

Songs you added (liked tracks and playlist tracks) stay separate from songs that are only there because an album was saved. The default view is songs you added.

## Setup

You need Node 20+, a Postgres database (local or [Neon](https://neon.tech)), and a Spotify app in development mode.

```bash
npm install
cp .env.example .env.local
npm run db:setup
npm run dev
```

The dev server listens on [http://127.0.0.1:3847](http://127.0.0.1:3847). Spotify does not accept `localhost` as a redirect host.

`npm run db:setup` applies `drizzle/` and loads a sample library. On the home page, **Open the sample library** signs you in as that sample listener without Spotify. That button exists only when `NODE_ENV` is not `production` and `DEV_PREVIEW=true`.

## Environment

| Variable | Purpose |
| --- | --- |
| `SPOTIFY_CLIENT_ID` | Public client id. This app does not use a client secret. |
| `SPOTIFY_REDIRECT_URI` | Must match the dashboard exactly. |
| `DATABASE_URL` | Postgres connection string. Use Neon's **direct** (non-pooler) string so sync transactions work. |
| `TOKEN_ENCRYPTION_KEY` | Encrypts Spotify refresh and access tokens at rest (AES-256-GCM). |
| `SESSION_SECRET` | Signs the httpOnly session cookie. |
| `OPENAI_API_KEY` | Optional. Chat is disabled until this is set. |
| `OPENAI_MODEL` | Defaults to `gpt-4o-mini`. |
| `DEV_PREVIEW` | `true` shows the sample-library login outside production. Ignored when `NODE_ENV=production`. |
| `CHAT_PER_HOUR` | Chat questions per user per hour. Default 20. |
| `CHAT_PER_DAY` | Chat questions per user per UTC day. Default 50. |
| `CHAT_DAILY_USD` | Estimated OpenAI spend per user per UTC day. Default `0.50`. |
| `SYNC_STARTS_PER_HOUR` | `POST /api/sync/start` per user per hour. Default 5. |
| `AUTH_PER_HOUR` | Sign-in attempts per IP per hour. Default 30. |

## Spotify dashboard

In the app settings, add these redirect URIs:

- Local: `http://127.0.0.1:3847/api/auth/callback`
- Production: `https://spotifylurk.vercel.app/api/auth/callback`

If you run Next on another port, change `SPOTIFY_REDIRECT_URI` and add that exact URI too. Use `127.0.0.1`, not `localhost`.

Development mode allows **5 users**. Add each person under **User Management** before they can sign in. The app owner needs Spotify Premium or the API will refuse requests. Extended quota mode is not required for this app, but followed playlists (ones you don't own or collaborate on) return 403 for their tracks. Pile keeps the playlist and marks the tracks unavailable instead of failing the sync.

Scopes requested: `user-library-read`, `playlist-read-private`, `playlist-read-collaborative`, `user-follow-read`, `user-top-read`, `user-read-recently-played`, `user-read-private`, `playlist-modify-private`, `playlist-modify-public`.

Login is Authorization Code with PKCE. There is no client secret. Refresh tokens are encrypted in Postgres. The browser only gets a signed httpOnly session cookie. Each query is scoped to that user.

## What the sync does

Refresh walks Spotify page by page:

- `GET /v1/me/tracks`
- `GET /v1/me/playlists`, then `GET /v1/playlists/{id}/items` (falls back to `/tracks`)
- `GET /v1/me/albums`, then `GET /v1/albums/{id}/tracks` when the album's track list is paged

429s with a short `Retry-After` are retried. Longer ones pause the sync and the browser waits. Access tokens refresh on expiry and on 401. Unchanged playlist snapshots are skipped. The same song is one row, matched by Spotify URI, then ISRC, then normalized title + primary artist. Popularity is often null in development mode and is not used.

## Limits

Chat posts, sync starts, and sign-in are capped in Postgres (`request_limits`), so the counters survive across Vercel instances. Apply `drizzle/0002_request_limits.sql` with `npm run db:migrate` before deploying.

`POST /api/chat` stops at `CHAT_PER_HOUR` and `CHAT_PER_DAY`. It also stops when today's rows in `token_usage_log` reach `CHAT_DAILY_USD`, and that check happens before the OpenAI call. `POST /api/sync/start` stops at `SYNC_STARTS_PER_HOUR`. Sync steps are not capped, because one library refresh is many short requests. `/api/auth/login`, `/api/auth/callback`, and the sample login share `AUTH_PER_HOUR` per IP.

Over a cap, the route returns **429** with `{ "error": "..." }` and a `Retry-After` header. Windows are fixed (hour, or UTC day) and can bunch at the boundary. Set a cap to `0` to block that route. Invalid values fall back to the defaults.

`POST /api/auth/dev` returns 404 when `NODE_ENV` is `production` or `DEV_PREVIEW` is not `true`. The home page hides the sample-library button on the same check.

## Chat

The model never receives the whole library. It gets tools that query Postgres and return at most 50 compact rows: `search_songs`, `library_stats`, `get_songs_by_ids`, and `propose_playlist`. Proposed playlists are drafts until you click **Save to Spotify**. Track ids are checked against your library. History sent to the model is the system prompt plus the last few turns. Each request logs token counts and an approximate cost, and the chat panel shows the same numbers.

Genre and mood data is not loaded. `artists.genres` is there for a later MusicBrainz / Last.fm pass (`src/lib/enrich/genres.ts`). Until then, the chat says so instead of guessing.

```bash
npm run ai:smoke
```

Runs one real question ("What artists did I save the most in 2021?") against the sample library when `OPENAI_API_KEY` is set. With no key, it prints a skip message and exits 0.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | App at http://127.0.0.1:3847 |
| `npm run db:migrate` | Apply SQL in `drizzle/` |
| `npm run db:seed` | Replace the sample library |
| `npm run db:setup` | Migrate and seed |
| `npm test` | Dedupe, Spotify client, sync, AI tools, and rate-limit tests |
| `npm run ai:smoke` | One live OpenAI request |
| `npm run build` | Production build |

Tests use a local database `pile_test` at `postgres://pile:pile@127.0.0.1:5432/pile_test`. Create it before `npm test` if it isn't there already.

## Deploy

Production is the Vercel project `spotifylurk` at [https://spotifylurk.vercel.app](https://spotifylurk.vercel.app).

Set `SPOTIFY_REDIRECT_URI` to `https://spotifylurk.vercel.app/api/auth/callback` and register that exact URI in the Spotify dashboard (callback route: `/api/auth/callback`). Use a Neon direct `DATABASE_URL`, set the other env vars from `.env.example`, and leave `DEV_PREVIEW` unset. Sync runs in short steps so a large library can finish across requests instead of one serverless invocation.
