import { describe, it, expect } from 'vitest';
import { parseTextGenResponse, parseImageGenResponse } from '../../server/bots';

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

describe('parseImageGenResponse', () => {
  it('returns a hosted url when present', () => {
    expect(parseImageGenResponse({ url: 'https://blob/x.png' })).toBe('https://blob/x.png');
    expect(parseImageGenResponse({ result: { imageUrl: 'https://blob/y.png' } })).toBe('https://blob/y.png');
  });
  it('builds a data: URL from the user-billed base64 response (the real prod shape)', () => {
    // This is exactly what /v1/ai/user-billed/image returns: base64 + mime, no url.
    const out = parseImageGenResponse({ type: 'base64', base64: 'AAAgID', mime: 'image/jpeg', width: 1024, height: 1024 });
    expect(out).toBe('data:image/jpeg;base64,AAAgID');
  });
  it('defaults mime to image/png when base64 has no mime', () => {
    expect(parseImageGenResponse({ base64: 'ZZZ' })).toBe('data:image/png;base64,ZZZ');
  });
  it('returns empty string when there is neither url nor base64', () => {
    expect(parseImageGenResponse({ foo: 'bar' })).toBe('');
    expect(parseImageGenResponse(null)).toBe('');
  });
});
