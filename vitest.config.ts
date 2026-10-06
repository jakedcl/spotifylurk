import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["./tests/setup.ts"],
    env: {
      DATABASE_URL: "postgres://pile:pile@127.0.0.1:5432/pile_test",
      SESSION_SECRET: "test-session-secret",
      TOKEN_ENCRYPTION_KEY: "test-encryption-key",
      DEV_PREVIEW: "true",
      SPOTIFY_CLIENT_ID: "test-client",
      SPOTIFY_REDIRECT_URI: "http://127.0.0.1:3847/api/auth/callback",
      OPENAI_MODEL: "gpt-4o-mini",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
