export interface MsgTelemetry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export function formatTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function formatCost(usd: number): string {
  if (usd === 0) return '$0.00';
  // Use 3 decimal places for sub-cent amounts; 2 otherwise.
  return `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
}

/**
 * Session totals for the telemetry strip.
 *
 * `totalTokens` sums OUTPUT tokens only — the tokens the model actually
 * GENERATED this session. Input tokens re-count the entire conversation context
 * on every turn (the model re-reads the whole thread each reply), so summing
 * them across a session over-counts massively and produces absurd numbers next
 * to a tiny cost (a persona saw "812k TOKENS · $0.16"). It was worse with a
 * legacy row whose context still held a base64 image (~400k tokens for one
 * reply). Output is the only per-turn-additive token quantity. Cost is summed
 * per-turn (each turn is billed once) and stays exact.
 */
export function sumTelemetry(msgs: MsgTelemetry[]): {
  messages: number;
  totalTokens: number;
  totalCostUsd: number;
  model: string;
} {
  let totalTokens = 0, totalCostUsd = 0, model = '';
  for (const m of msgs) {
    totalTokens += m.outputTokens || 0;
    totalCostUsd += m.costUsd || 0;
    if (m.model) model = m.model;
  }
  return { messages: msgs.length, totalTokens, totalCostUsd, model };
}
