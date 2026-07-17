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
  it('sums a session — OUTPUT tokens only (input re-counts context every turn)', () => {
    const msgs: MsgTelemetry[] = [
      { model: 'DeepSeek v4 pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004, latencyMs: 1400 },
      { model: 'DeepSeek v4 pro', inputTokens: 96, outputTokens: 842, costUsd: 0.003, latencyMs: 900 },
    ];
    const t = sumTelemetry(msgs);
    expect(t.totalTokens).toBe(1204 + 842); // generated only, not input+output
    expect(t.totalCostUsd).toBeCloseTo(0.007, 6); // cost stays exact
    expect(t.messages).toBe(2);
    expect(t.model).toBe('DeepSeek v4 pro');
  });

  it('a huge-input row (legacy base64 image in context) does not blow up the total', () => {
    // The bug: one reply whose context still held a 572KB base64 image reported
    // ~400k INPUT tokens. Summing input made the strip read "812k · $0.16".
    const msgs: MsgTelemetry[] = [
      { model: 'm', inputTokens: 403412, outputTokens: 134, costUsd: 0.056, latencyMs: 1 },
      { model: 'm', inputTokens: 455, outputTokens: 66, costUsd: 0.0001, latencyMs: 1 },
    ];
    expect(sumTelemetry(msgs).totalTokens).toBe(134 + 66); // 200, not 404k
  });
});
