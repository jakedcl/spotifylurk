import { afterAll, beforeAll, beforeEach } from "vitest";
import { closeDb, getPool } from "../src/db";
import { migrate } from "../scripts/migrate";

beforeAll(async () => {
  await migrate();
});

beforeEach(async () => {
  await getPool().query(`TRUNCATE TABLE
    token_usage_log,
    chat_messages,
    playlist_proposals,
    sync_runs,
    track_sources,
    track_artists,
    track_aliases,
    tracks,
    playlists,
    albums,
    artists,
    users
    RESTART IDENTITY CASCADE`);
});

afterAll(async () => {
  await closeDb();
});
