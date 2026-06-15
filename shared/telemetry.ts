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

export function sumTelemetry(msgs: MsgTelemetry[]): {
  messages: number;
  totalTokens: number;
  totalCostUsd: number;
  model: string;
} {
  let totalTokens = 0, totalCostUsd = 0, model = '';
  for (const m of msgs) {
    totalTokens += (m.inputTokens || 0) + (m.outputTokens || 0);
    totalCostUsd += m.costUsd || 0;
    if (m.model) model = m.model;
  }
  return { messages: msgs.length, totalTokens, totalCostUsd, model };
}
