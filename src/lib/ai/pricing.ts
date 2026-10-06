const PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
};

/** Approximate USD. Mini prices are the published rates we bill against; other models fall back to gpt-4o-mini. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number) {
  const price = PER_MILLION[model] ?? PER_MILLION["gpt-4o-mini"];
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}
