import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.log("OPENAI_API_KEY is not set. Skipping the live chat request.");
    return;
  }
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { getPool, closeDb } = await import("../src/db");
  const { createOpenAIClient } = await import("../src/lib/ai/openai");
  const { runChat } = await import("../src/lib/ai/chat");
  const pool = getPool();
  const user = await pool.query<{ id: string }>(`SELECT id FROM users WHERE spotify_id = 'dev-sample' LIMIT 1`);
  if (!user.rows[0]) {
    throw new Error("Sample listener is missing. Run npm run db:seed first.");
  }
  const result = await runChat({
    userId: user.rows[0].id,
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    client: createOpenAIClient(process.env.OPENAI_API_KEY),
    history: [],
    userMessage: "What artists did I save the most in 2021?",
  });
  console.log(result.content);
  console.log(
    `tokens prompt=${result.usage.promptTokens} completion=${result.usage.completionTokens} estimated_cost_usd=${result.usage.estimatedCostUsd.toFixed(6)}`,
  );
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
