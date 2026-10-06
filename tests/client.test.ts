import { describe, expect, it } from "vitest";
import { publicOrigin } from "../src/lib/redirect";
import { SpotifyApiError, SpotifyClient, SpotifyRateLimit } from "../src/lib/spotify/client";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("SpotifyClient", () => {
  it("retries a short 429 and refreshes once on 401", async () => {
    const calls: string[] = [];
    let refreshed = 0;
    const client = new SpotifyClient({
      sleep: async () => undefined,
      getAccessToken: async () => (refreshed ? "new" : "old"),
      refreshAccessToken: async () => {
        refreshed += 1;
        return "new";
      },
      fetch: async (input) => {
        const url = new URL(String(input));
        calls.push(url.pathname);
        if (url.pathname.endsWith("/limited")) {
          if (calls.filter((path) => path.endsWith("/limited")).length === 1) {
            return jsonResponse({ error: "slow" }, 429, { "retry-after": "0" });
          }
          return jsonResponse({ ok: true });
        }
        if (calls.filter((path) => path.endsWith("/me")).length === 1) return jsonResponse({ error: "expired" }, 401);
        return jsonResponse({ id: "me" });
      },
    });

    await expect(client.get("/v1/limited")).resolves.toEqual({ ok: true });
    await expect(client.get("/v1/me")).resolves.toEqual({ id: "me" });
    expect(refreshed).toBe(1);
  });

  it("pauses instead of blocking when Retry-After is long", async () => {
    const client = new SpotifyClient({
      getAccessToken: async () => "token",
      refreshAccessToken: async () => "token",
      fetch: async () => jsonResponse({}, 429, { "retry-after": "8" }),
    });
    await expect(client.get("/v1/me/tracks")).rejects.toBeInstanceOf(SpotifyRateLimit);
  });

  it("surfaces 403 without retrying forever", async () => {
    let hits = 0;
    const client = new SpotifyClient({
      getAccessToken: async () => "token",
      refreshAccessToken: async () => "token",
      fetch: async () => {
        hits += 1;
        return jsonResponse({ error: "forbidden" }, 403);
      },
    });
    await expect(client.get("/v1/playlists/x/items")).rejects.toBeInstanceOf(SpotifyApiError);
    expect(hits).toBe(1);
  });
});

describe("publicOrigin", () => {
  it("keeps the browser host when Next reports localhost", () => {
    const headers = new Headers({ host: "127.0.0.1:3847" });
    expect(publicOrigin(headers, "http://localhost:3847")).toBe("http://127.0.0.1:3847");
    const forwarded = new Headers({
      "x-forwarded-host": "pile.example.com",
      "x-forwarded-proto": "https",
    });
    expect(publicOrigin(forwarded, "http://localhost:3847")).toBe("https://pile.example.com");
  });
});
