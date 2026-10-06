import { SpotifyClient } from "./client";
import { getValidAccessToken, refreshAccessToken } from "./tokens";

export function clientForUser(userId: string) {
  return new SpotifyClient({
    getAccessToken: () => getValidAccessToken(userId),
    refreshAccessToken: () => refreshAccessToken(userId),
  });
}
