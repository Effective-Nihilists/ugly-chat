import { describe, it, expect } from 'vitest';
import { parseTextGenResponse } from '../../server/bots';

describe('parseTextGenResponse', () => {
  it('extracts text + usage when present', () => {
    const r = parseTextGenResponse({
      message: { content: 'hello' },
      usage: { model: 'deepseek_v4_pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004 },
    });
    expect(r.text).toBe('hello');
    expect(r.usage).toEqual({ model: 'deepseek_v4_pro', inputTokens: 118, outputTokens: 1204, costUsd: 0.004, latencyMs: 0 });
  });
  it('defaults usage to zeros when absent and joins block arrays', () => {
    const r = parseTextGenResponse({ message: { content: [{ type: 'text', text: 'hi' }] } });
    expect(r.text).toBe('hi');
    expect(r.usage).toEqual({ model: '', inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0 });
  });
});
