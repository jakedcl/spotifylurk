export function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function devPreviewEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.DEV_PREVIEW === "true";
}

export const SPOTIFY_SCOPES = [
  "user-library-read",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-follow-read",
  "user-top-read",
  "user-read-recently-played",
  "user-read-private",
  "playlist-modify-private",
  "playlist-modify-public",
].join(" ");
