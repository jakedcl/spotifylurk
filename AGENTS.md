# AGENTS.md — spotifylurk

Spotify Lurk: every song you saved in one list. Signs in with Spotify, syncs liked songs, playlist tracks, and saved-album tracks into Postgres, then lets you filter or ask an AI chat about the library. Production: spotifylurk.vercel.app.

## Stack
- Next.js 16.3 (App Router), React 19.2, TypeScript, Tailwind CSS 4, @tanstack/react-virtual.
- Postgres (Neon or local) with Drizzle ORM 0.45 and `pg`. SQL migrations in `drizzle/`.
- OpenAI chat (`gpt-4o-mini` by default) with tool calls. Vitest for tests.

## Layout
- `src/app/` (`library/`, `api/auth|chat|library|playlists|proposals|sync`). `src/components/`.
- `src/lib/spotify/` (client, tokens, sync, save-playlist), `src/lib/library/` (dedupe, filters, query, persist), `src/lib/ai/` (chat, tools, pricing), `src/lib/limits.ts`, `crypto.ts`, `session.ts`. `src/db/`.
- `scripts/` migrate, seed, ai-smoke. `tests/`.

## Commands
- `npm run db:setup` (migrate + sample library), `npm run dev` (http://127.0.0.1:3847), `npm test`, `npm run lint`, `npm run build`.
- `npm run ai:smoke` runs one real question if `OPENAI_API_KEY` is set.

## Gotchas
- Use `127.0.0.1`, not `localhost`. Spotify rejects localhost redirect URIs, and `SPOTIFY_REDIRECT_URI` must match the dashboard exactly.
- PKCE login, no client secret. Tokens are AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY`. The browser only gets a signed httpOnly cookie. Scope every query to the user.
- `DATABASE_URL` must be Neon's **direct** (non-pooler) string so sync transactions work.
- Rate and spend caps live in Postgres `request_limits` / `token_usage_log`. The spend check runs before the OpenAI call. Keep it that way.
- The model never gets the whole library. Tools return at most 50 rows. Proposed playlists stay drafts until "Save to Spotify".
- `POST /api/auth/dev` must 404 in production or unless `DEV_PREVIEW=true`.
- Spotify dev mode allows 5 users. Followed playlists 403 on tracks; mark them unavailable, don't fail the sync. No genre data yet, so don't guess genres.
