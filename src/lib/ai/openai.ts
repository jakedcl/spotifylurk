export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type LlmUsage = { prompt_tokens?: number; completion_tokens?: number };

export type LlmCompletion = {
  model: string;
  messages: LlmMessage[];
  tools?: readonly unknown[];
  tool_choice?: "auto" | "none";
  temperature?: number;
};

export interface LlmClient {
  complete(request: LlmCompletion): Promise<{ message: LlmMessage; usage?: LlmUsage }>;
}

export function createOpenAIClient(apiKey: string, fetchImpl: typeof fetch = fetch): LlmClient {
  return {
    async complete(request) {
      const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: request.model,
          temperature: request.temperature ?? 0.2,
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tools ? (request.tool_choice ?? "auto") : undefined,
        }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`OpenAI ${response.status}: ${text.slice(0, 400)}`);
      const json = JSON.parse(text) as {
        choices?: { message?: LlmMessage }[];
        usage?: LlmUsage;
      };
      const message = json.choices?.[0]?.message;
      if (!message) throw new Error("OpenAI returned no message.");
      return { message, usage: json.usage };
    },
  };
}
