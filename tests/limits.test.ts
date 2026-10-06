import { afterEach, describe, expect, it, vi } from "vitest";
import { getPool } from "../src/db";
import { rateLimitError } from "../src/lib/http";
import { DAY_MS, HOUR_MS, clientIp, consumeLimit, dailyAiSpendUsd, enforceAuth, enforceChatPost, enforceSyncStart, limitConfig } from "../src/lib/limits";
import { insertUser } from "./helpers";

const noon = Date.UTC(2026, 0, 2, 12, 0, 0);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp", () => {
  it("prefers x-real-ip, then the last Vercel hop, then the first forwarded address", () => {
    const real = new Request("http://127.0.0.1/", {
      headers: {
        "x-real-ip": "203.0.113.8",
        "x-vercel-forwarded-for": "198.51.100.1, 203.0.113.9",
        "x-forwarded-for": "198.51.100.2",
      },
    });
    expect(clientIp(real)).toBe("203.0.113.8");

    const vercel = new Request("http://127.0.0.1/", {
      headers: { "x-vercel-forwarded-for": "198.51.100.1, 203.0.113.9" },
    });
    expect(clientIp(vercel)).toBe("203.0.113.9");

    const forwarded = new Request("http://127.0.0.1/", {
      headers: { "x-forwarded-for": "203.0.113.4, 10.0.0.1" },
    });
    expect(clientIp(forwarded)).toBe("203.0.113.4");
    expect(clientIp(new Request("http://127.0.0.1/"))).toBe("unknown");
  });
});

describe("limitConfig", () => {
  it("uses defaults, accepts zero, and ignores invalid numbers", () => {
    expect(limitConfig()).toMatchObject({
      chatPerHour: 20,
      chatPerDay: 50,
      chatDailyUsd: 0.5,
      syncStartsPerHour: 5,
      authPerHour: 30,
    });
    vi.stubEnv("CHAT_PER_HOUR", "0");
    vi.stubEnv("CHAT_DAILY_USD", "1.25");
    vi.stubEnv("AUTH_PER_HOUR", "nope");
    expect(limitConfig()).toMatchObject({ chatPerHour: 0, chatDailyUsd: 1.25, authPerHour: 30 });
  });
});

describe("consumeLimit", () => {
  it("allows the cap inside a window and resets on the next one", async () => {
    const bucket = "chat:hour:window";
    for (let hit = 0; hit < 2; hit += 1) {
      const allowed = await consumeLimit({ bucket, limit: 2, windowMs: HOUR_MS, now: noon + hit });
      expect(allowed.ok).toBe(true);
    }
    const blocked = await consumeLimit({ bucket, limit: 2, windowMs: HOUR_MS, now: noon + 5 });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);

    const nextWindow = await consumeLimit({ bucket, limit: 2, windowMs: HOUR_MS, now: noon + HOUR_MS });
    expect(nextWindow.ok).toBe(true);

    const otherBucket = await consumeLimit({ bucket: "chat:hour:other", limit: 2, windowMs: HOUR_MS, now: noon + 5 });
    expect(otherBucket.ok).toBe(true);
  });
});

describe("daily AI guard", () => {
  it("ignores spend from the previous UTC day and blocks once today's total reaches the cap", async () => {
    const userId = await insertUser("spend-user");
    const dayStart = noon - 12 * HOUR_MS;
    await getPool().query(
      `INSERT INTO token_usage_log (user_id, model, prompt_tokens, completion_tokens, estimated_cost_usd, created_at)
       VALUES ($1, 'gpt-4o-mini', 10, 10, 9, $2), ($1, 'gpt-4o-mini', 10, 10, 0.25, $3)`,
      [userId, new Date(dayStart - 1000), new Date(dayStart + 1000)],
    );
    expect(await dailyAiSpendUsd(userId, noon)).toBe(0.25);

    vi.stubEnv("CHAT_PER_HOUR", "20");
    vi.stubEnv("CHAT_PER_DAY", "50");
    vi.stubEnv("CHAT_DAILY_USD", "0.5");
    const under = await enforceChatPost(userId, noon);
    expect(under.ok).toBe(true);

    await getPool().query(
      `INSERT INTO token_usage_log (user_id, model, prompt_tokens, completion_tokens, estimated_cost_usd, created_at)
       VALUES ($1, 'gpt-4o-mini', 10, 10, 0.25, $2)`,
      [userId, new Date(dayStart + 2000)],
    );
    const capped = await enforceChatPost(userId, noon + 1000);
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.message).toMatch(/AI budget/);
  });

  it("caps questions per hour and per UTC day", async () => {
    vi.stubEnv("CHAT_DAILY_USD", "5");
    const hourUser = await insertUser("hour-user");
    vi.stubEnv("CHAT_PER_HOUR", "2");
    vi.stubEnv("CHAT_PER_DAY", "50");
    expect((await enforceChatPost(hourUser, noon)).ok).toBe(true);
    expect((await enforceChatPost(hourUser, noon + 1)).ok).toBe(true);
    const hourly = await enforceChatPost(hourUser, noon + 2);
    expect(hourly.ok).toBe(false);
    if (!hourly.ok) expect(hourly.message).toMatch(/this hour/);

    const dayUser = await insertUser("day-user");
    vi.stubEnv("CHAT_PER_HOUR", "20");
    vi.stubEnv("CHAT_PER_DAY", "1");
    expect((await enforceChatPost(dayUser, noon)).ok).toBe(true);
    const daily = await enforceChatPost(dayUser, noon + 1);
    expect(daily.ok).toBe(false);
    if (!daily.ok) expect(daily.message).toMatch(/today's question limit/i);
    expect((await enforceChatPost(dayUser, noon + DAY_MS)).ok).toBe(true);
  });
});

describe("sync and auth limits", () => {
  it("caps sync starts per user", async () => {
    vi.stubEnv("SYNC_STARTS_PER_HOUR", "1");
    const userId = await insertUser("sync-user");
    expect((await enforceSyncStart(userId, noon)).ok).toBe(true);
    const blocked = await enforceSyncStart(userId, noon + 1);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/syncs this hour/);
  });

  it("caps auth attempts per IP", async () => {
    vi.stubEnv("AUTH_PER_HOUR", "1");
    const first = new Request("http://127.0.0.1/api/auth/login", { headers: { "x-real-ip": "203.0.113.10" } });
    const again = new Request("http://127.0.0.1/api/auth/callback", { headers: { "x-real-ip": "203.0.113.10" } });
    const other = new Request("http://127.0.0.1/api/auth/login", { headers: { "x-real-ip": "203.0.113.11" } });
    expect((await enforceAuth(first, noon)).ok).toBe(true);
    const blocked = await enforceAuth(again, noon + 1);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.message).toMatch(/sign-in attempts/);
    expect((await enforceAuth(other, noon + 1)).ok).toBe(true);
  });
});

describe("rateLimitError", () => {
  it("returns 429 with the message and Retry-After", async () => {
    const response = rateLimitError("Slow down.", 90);
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("90");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ error: "Slow down." });
  });
});
