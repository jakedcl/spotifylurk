import { estimateCostUsd } from "./pricing";
import { TOOLS, executeTool, type ProposalCard } from "./tools";
import type { LlmClient, LlmMessage, ToolCall } from "./openai";

export const SYSTEM_PROMPT = `You answer questions about the signed-in user's saved Spotify music and draft playlists from it.
Use tools for every fact. Never invent songs, artists, or track ids.
"Saved in a year" means added_year. A decade like the 1970s means release decade 1970.
source_scope "added" is liked songs and playlist tracks. "album" is songs that only appear because an album was saved.
Genres and moods are not loaded yet. If asked, say so, then filter with explicit, year, artist, and title.
propose_playlist only accepts ids from tool results and only makes a draft. You cannot save to Spotify.
Keep replies short.`;

export type HistoryTurn = { role: "user" | "assistant"; content: string };

export function trimHistory(history: HistoryTurn[]) {
  return history.slice(-6).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 800),
  }));
}

export type ChatResult = {
  content: string;
  proposals: ProposalCard[];
  usage: { promptTokens: number; completionTokens: number; estimatedCostUsd: number };
};

function callsOf(message: LlmMessage): ToolCall[] {
  return Array.isArray(message.tool_calls) ? message.tool_calls : [];
}

export async function runChat(opts: {
  userId: string;
  model: string;
  client: LlmClient;
  history: HistoryTurn[];
  userMessage: string;
}): Promise<ChatResult> {
  const messages: LlmMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...trimHistory(opts.history).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: opts.userMessage.slice(0, 2000) },
  ];
  let promptTokens = 0;
  let completionTokens = 0;
  const proposals: ProposalCard[] = [];

  const takeUsage = (usage?: { prompt_tokens?: number; completion_tokens?: number }) => {
    promptTokens += usage?.prompt_tokens ?? 0;
    completionTokens += usage?.completion_tokens ?? 0;
  };

  for (let round = 0; round < 4; round += 1) {
    const response = await opts.client.complete({
      model: opts.model,
      messages,
      tools: TOOLS,
      temperature: 0.2,
    });
    takeUsage(response.usage);
    const calls = callsOf(response.message);
    if (!calls.length) {
      return finish(opts.model, response.message.content, proposals, promptTokens, completionTokens);
    }
    messages.push({ role: "assistant", content: response.message.content ?? null, tool_calls: calls });
    for (const call of calls) {
      let args: unknown = {};
      try {
        args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
      } catch {
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({ error: "Arguments were not valid JSON." }),
        });
        continue;
      }
      const outcome = await executeTool(opts.userId, call.function.name, args);
      if (outcome.proposal) proposals.push(outcome.proposal);
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(outcome.forModel).slice(0, 6000),
      });
    }
  }

  const finalResponse = await opts.client.complete({
    model: opts.model,
    messages,
    tools: TOOLS,
    tool_choice: "none",
    temperature: 0.2,
  });
  takeUsage(finalResponse.usage);
  return finish(opts.model, finalResponse.message.content, proposals, promptTokens, completionTokens);
}

function finish(model: string, content: string | null, proposals: ProposalCard[], promptTokens: number, completionTokens: number) {
  const estimatedCostUsd = estimateCostUsd(model, promptTokens, completionTokens);
  console.log(
    `[pile] model=${model} prompt_tokens=${promptTokens} completion_tokens=${completionTokens} estimated_cost_usd=${estimatedCostUsd.toFixed(6)}`,
  );
  const trimmed = content?.trim() ?? "";
  return {
    content: trimmed || (proposals.length ? "Drafted a playlist from your library." : "I couldn't answer that from your library."),
    proposals,
    usage: { promptTokens, completionTokens, estimatedCostUsd },
  };
}
