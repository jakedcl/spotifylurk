import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "../src/app/api/auth/dev/route";
import { devPreviewEnabled } from "../src/lib/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("devPreviewEnabled", () => {
  it("stays off in production even when DEV_PREVIEW is true", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_PREVIEW", "true");
    expect(devPreviewEnabled()).toBe(false);
  });

  it("stays off unless DEV_PREVIEW is exactly true", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_PREVIEW", "");
    expect(devPreviewEnabled()).toBe(false);
    vi.stubEnv("DEV_PREVIEW", "false");
    expect(devPreviewEnabled()).toBe(false);
    vi.stubEnv("DEV_PREVIEW", "true");
    expect(devPreviewEnabled()).toBe(true);
  });
});

describe("POST /api/auth/dev", () => {
  it("returns 404 in production and does not set a session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DEV_PREVIEW", "true");
    const response = await POST(new NextRequest("http://127.0.0.1:3847/api/auth/dev", { method: "POST" }));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not available." });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns 404 when DEV_PREVIEW is unset", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DEV_PREVIEW", "");
    const response = await POST(new NextRequest("http://127.0.0.1:3847/api/auth/dev", { method: "POST" }));
    expect(response.status).toBe(404);
  });
});
