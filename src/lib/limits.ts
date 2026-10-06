import { createHash } from "crypto";
import { getPool } from "@/db";

export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

export type LimitDecision =
  | { ok: true }
  | { ok: false; message: string; retryAfterSeconds: number };

function configuredNumber(name: string, fallback: number, integer: boolean) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return fallback;
  if (integer && !Number.isInteger(value)) return fallback;
  return value;
}

/** Defaults apply when the env var is unset or invalid. `0` blocks the route. */
export function limitConfig() {
  return {
    chatPerHour: configuredNumber("CHAT_PER_HOUR", 20, true),
    chatPerDay: configuredNumber("CHAT_PER_DAY", 50, true),
    chatDailyUsd: configuredNumber("CHAT_DAILY_USD", 0.5, false),
    syncStartsPerHour: configuredNumber("SYNC_STARTS_PER_HOUR", 5, true),
    authPerHour: configuredNumber("AUTH_PER_HOUR", 30, true),
  };
}

function firstIp(value: string | null) {
  const ip = value?.split(",")[0]?.trim();
  return ip || null;
}

function lastIp(value: string | null) {
  if (!value) return null;
  const parts = value.split(",").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? null;
}

/** Prefer platform-set addresses. Vercel sets x-real-ip; the client can spoof a leading x-forwarded-for. */
export function clientIp(request: Request) {
  return (
    firstIp(request.headers.get("x-real-ip")) ||
    lastIp(request.headers.get("x-vercel-forwarded-for")) ||
    firstIp(request.headers.get("x-forwarded-for")) ||
    "unknown"
  );
}

function authBucket(ip: string) {
  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return `auth:${hash}`;
}

function alignWindow(now: number, windowMs: number) {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

function retryAfter(now: number, windowMs: number) {
  const start = Math.floor(now / windowMs) * windowMs;
  return Math.max(1, Math.ceil((start + windowMs - now) / 1000));
}

export async function consumeLimit(input: { bucket: string; limit: number; windowMs: number; now?: number }) {
  const now = input.now ?? Date.now();
  const start = alignWindow(now, input.windowMs);
  const pool = getPool();
  const result = await pool.query<{ hits: number }>(
    `INSERT INTO request_limits (bucket, window_start, hits)
     VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start)
     DO UPDATE SET hits = request_limits.hits + 1
     RETURNING hits`,
    [input.bucket, start],
  );
  const hits = result.rows[0]?.hits;
  if (hits === 1) {
    await pool.query(`DELETE FROM request_limits WHERE window_start < $1`, [new Date(now - 2 * DAY_MS)]);
  }
  if (hits === undefined || hits > input.limit) {
    return { ok: false as const, retryAfterSeconds: retryAfter(now, input.windowMs) };
  }
  return { ok: true as const };
}

export async function dailyAiSpendUsd(userId: string, now = Date.now()) {
  const start = alignWindow(now, DAY_MS);
  const result = await getPool().query<{ cost: string }>(
    `SELECT coalesce(sum(estimated_cost_usd), 0)::text AS cost
     FROM token_usage_log
     WHERE user_id = $1 AND created_at >= $2`,
    [userId, start],
  );
  return Number(result.rows[0]?.cost ?? 0);
}

export async function enforceChatPost(userId: string, now = Date.now()): Promise<LimitDecision> {
  const config = limitConfig();
  const hourly = await consumeLimit({
    bucket: `chat:hour:${userId}`,
    limit: config.chatPerHour,
    windowMs: HOUR_MS,
    now,
  });
  if (!hourly.ok) {
    return {
      ok: false,
      retryAfterSeconds: hourly.retryAfterSeconds,
      message: "You've asked a lot this hour. Try again in a bit.",
    };
  }

  const spent = await dailyAiSpendUsd(userId, now);
  if (spent >= config.chatDailyUsd) {
    return {
      ok: false,
      retryAfterSeconds: retryAfter(now, DAY_MS),
      message: "Today's AI budget for this account is used up. It resets at midnight UTC.",
    };
  }

  const daily = await consumeLimit({
    bucket: `chat:day:${userId}`,
    limit: config.chatPerDay,
    windowMs: DAY_MS,
    now,
  });
  if (!daily.ok) {
    return {
      ok: false,
      retryAfterSeconds: daily.retryAfterSeconds,
      message: "You've reached today's question limit. It resets at midnight UTC.",
    };
  }
  return { ok: true };
}

export async function enforceSyncStart(userId: string, now = Date.now()): Promise<LimitDecision> {
  const config = limitConfig();
  const result = await consumeLimit({
    bucket: `sync:hour:${userId}`,
    limit: config.syncStartsPerHour,
    windowMs: HOUR_MS,
    now,
  });
  if (!result.ok) {
    return {
      ok: false,
      retryAfterSeconds: result.retryAfterSeconds,
      message: "You've started several syncs this hour. Try again later.",
    };
  }
  return { ok: true };
}

export async function enforceAuth(request: Request, now = Date.now()): Promise<LimitDecision> {
  const config = limitConfig();
  const result = await consumeLimit({
    bucket: authBucket(clientIp(request)),
    limit: config.authPerHour,
    windowMs: HOUR_MS,
    now,
  });
  if (!result.ok) {
    return {
      ok: false,
      retryAfterSeconds: result.retryAfterSeconds,
      message: "Too many sign-in attempts. Try again later.",
    };
  }
  return { ok: true };
}
