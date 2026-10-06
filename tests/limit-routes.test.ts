import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/users", () => ({
  getCurrentUser: vi.fn(),
}));

import { GET as login } from "../src/app/api/auth/login/route";
import { POST as chat } from "../src/app/api/chat/route";
import { POST as syncStart } from "../src/app/api/sync/start/route";
import { getCurrentUser } from "../src/lib/users";

const user = {
  id: "00000000-0000-4000-8000-000000000099",
  spotifyId: "limit-user",
  displayName: "Limit",
  imageUrl: null,
  isDev: false,
  hasSpotify: true,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.mocked(getCurrentUser).mockReset();
});

describe("route wiring", () => {
  it("blocks chat posts when the daily question cap is zero", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.stubEnv("OPENAI_API_KEY", "test-key");
    vi.stubEnv("CHAT_PER_DAY", "0");
    const response = await chat(
      new Request("http://127.0.0.1:3847/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What did I save in 2021?" }),
      }),
    );
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/question limit/);
    expect(response.headers.get("Retry-After")).toBeTruthy();
  });

  it("blocks a new sync when the hourly start cap is zero", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(user);
    vi.stubEnv("SYNC_STARTS_PER_HOUR", "0");
    const response = await syncStart(new Request("http://127.0.0.1:3847/api/sync/start", { method: "POST" }));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/syncs this hour/);
  });

  it("blocks the second sign-in from the same IP", async () => {
    vi.stubEnv("AUTH_PER_HOUR", "1");
    const request = () =>
      new NextRequest("http://127.0.0.1:3847/api/auth/login", {
        headers: { "x-real-ip": "203.0.113.50" },
      });
    const first = await login(request());
    expect(first.status).toBeGreaterThanOrEqual(300);
    expect(first.status).toBeLessThan(400);
    const second = await login(request());
    expect(second.status).toBe(429);
    const body = (await second.json()) as { error: string };
    expect(body.error).toMatch(/sign-in attempts/);
  });
});
