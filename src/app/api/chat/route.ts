import { getPool } from "@/db";
import { runChat } from "@/lib/ai/chat";
import { createOpenAIClient } from "@/lib/ai/openai";
import { isUser, jsonError, rateLimitError, requireUser } from "@/lib/http";
import { enforceChatPost } from "@/lib/limits";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Usage = { promptTokens: number; completionTokens: number; estimatedCostUsd: number };

export async function GET() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  const pool = getPool();
  const messages = await pool.query<{
    id: string;
    role: "user" | "assistant";
    content: string;
    proposal_ids: string[] | null;
    usage: Usage | null;
    created_at: Date;
  }>(
    `SELECT id, role, content, proposal_ids, usage, created_at
     FROM chat_messages WHERE user_id = $1 ORDER BY created_at ASC LIMIT 200`,
    [user.id],
  );
  const proposals = await pool.query(
    `SELECT id, name, description, track_ids, status, spotify_playlist_id, error, created_at
     FROM playlist_proposals WHERE user_id = $1 ORDER BY created_at ASC LIMIT 50`,
    [user.id],
  );
  const tracks = await hydrateProposals(
    user.id,
    proposals.rows as {
      id: string;
      name: string;
      description: string | null;
      track_ids: string[];
      status: "proposed" | "saved" | "failed";
      spotify_playlist_id: string | null;
      error: string | null;
    }[],
  );
  return Response.json({
    messages: messages.rows.map((row) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      proposalIds: row.proposal_ids ?? [],
      usage: row.usage,
      createdAt: row.created_at.toISOString(),
    })),
    proposals: tracks,
  });
}

export async function POST(request: Request) {
  const user = await requireUser();
  if (!isUser(user)) return user;
  const body = (await request.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return jsonError("Write a question first.");
  if (message.length > 2000) return jsonError("That question is too long.");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return jsonError("Set OPENAI_API_KEY to ask questions about your library.", 400);
  const limited = await enforceChatPost(user.id);
  if (!limited.ok) return rateLimitError(limited.message, limited.retryAfterSeconds);

  const pool = getPool();
  const prior = await pool.query<{ role: "user" | "assistant"; content: string }>(
    `SELECT role, content FROM chat_messages
     WHERE user_id = $1 AND content <> ''
     ORDER BY created_at DESC LIMIT 6`,
    [user.id],
  );
  await pool.query(`INSERT INTO chat_messages (user_id, role, content) VALUES ($1, 'user', $2)`, [user.id, message]);
  try {
    const result = await runChat({
      userId: user.id,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      client: createOpenAIClient(apiKey),
      history: prior.rows.reverse(),
      userMessage: message,
    });
    const saved = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO chat_messages (user_id, role, content, proposal_ids, usage)
       VALUES ($1, 'assistant', $2, $3::uuid[], $4::jsonb)
       RETURNING id, created_at`,
      [user.id, result.content, result.proposals.map((proposal) => proposal.id), JSON.stringify(result.usage)],
    );
    await pool.query(
      `INSERT INTO token_usage_log (user_id, model, prompt_tokens, completion_tokens, estimated_cost_usd)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.id, process.env.OPENAI_MODEL || "gpt-4o-mini", result.usage.promptTokens, result.usage.completionTokens, result.usage.estimatedCostUsd],
    );
    return Response.json({
      message: {
        id: saved.rows[0].id,
        role: "assistant",
        content: result.content,
        proposalIds: result.proposals.map((proposal) => proposal.id),
        usage: result.usage,
        createdAt: saved.rows[0].created_at.toISOString(),
      },
      proposals: result.proposals,
      usage: result.usage,
    });
  } catch (error) {
    console.error(error);
    return jsonError("The chat request failed.", 502);
  }
}

export async function DELETE() {
  const user = await requireUser();
  if (!isUser(user)) return user;
  const pool = getPool();
  await pool.query(`DELETE FROM chat_messages WHERE user_id = $1`, [user.id]);
  await pool.query(`DELETE FROM playlist_proposals WHERE user_id = $1 AND status = 'proposed'`, [user.id]);
  return Response.json({ ok: true });
}

async function hydrateProposals(
  userId: string,
  proposals: {
    id: string;
    name: string;
    description: string | null;
    track_ids: string[];
    status: "proposed" | "saved" | "failed";
    spotify_playlist_id: string | null;
    error: string | null;
  }[],
) {
  const ids = [...new Set(proposals.flatMap((proposal) => proposal.track_ids ?? []))];
  const tracks = ids.length
    ? await getPool().query<{ id: string; name: string; duration_ms: number; artists: string | null }>(
        `SELECT t.id, t.name, t.duration_ms,
                (SELECT string_agg(ar.name, ', ' ORDER BY ta.position)
                 FROM track_artists ta JOIN artists ar ON ar.id = ta.artist_id
                 WHERE ta.track_id = t.id) AS artists
         FROM tracks t WHERE t.user_id = $1 AND t.id = ANY($2::uuid[])`,
        [userId, ids],
      )
    : { rows: [] };
  const byId = new Map(tracks.rows.map((row) => [row.id, row]));
  return proposals.map((proposal) => {
    const rows = (proposal.track_ids ?? []).map((id) => byId.get(id)).filter((row) => Boolean(row));
    return {
      id: proposal.id,
      name: proposal.name,
      description: proposal.description,
      trackCount: proposal.track_ids?.length ?? 0,
      durationMs: rows.reduce((sum, row) => sum + (row?.duration_ms ?? 0), 0),
      status: proposal.status,
      spotifyPlaylistId: proposal.spotify_playlist_id,
      error: proposal.error,
      tracks: rows.slice(0, 8).map((row) => ({
        id: row!.id,
        name: row!.name,
        artists: row!.artists ?? "",
        durationMs: row!.duration_ms,
      })),
    };
  });
}
