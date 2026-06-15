import { describe, it, expect } from 'vitest';
import { formatTokens, formatCost, sumTelemetry, type MsgTelemetry } from '../../shared/telemetry';

describe('telemetry', () => {
  it('formats tokens compactly', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(84200)).toBe('84.2k');
  });
  it('formats cost with 3 decimals and a leading $', () => {
    expect(formatCost(0.004)).toBe('$0.004');
    expect(formatCost(0.21)).toBe('$0.21');
    expect(formatCost(0)).toBe('$0.00');
  });
  it('sums a session', () => {
    const msgs: MsgTelemetry[] = [
      { model: 'DeepSeek v4 pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004, latencyMs: 1400 },
      { model: 'DeepSeek v4 pro', inputTokens: 96, outputTokens: 842, costUsd: 0.003, latencyMs: 900 },
    ];
    const t = sumTelemetry(msgs);
    expect(t.totalTokens).toBe(118 + 1204 + 96 + 842);
    expect(t.totalCostUsd).toBeCloseTo(0.007, 6);
    expect(t.messages).toBe(2);
    expect(t.model).toBe('DeepSeek v4 pro');
  });
});
