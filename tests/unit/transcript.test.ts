import { describe, it, expect } from 'vitest';
import { upsertTurn, type Turn } from '../../shared/transcript';

describe('upsertTurn', () => {
  it('replaces the live (non-final) turn for a speaker, then appends on final', () => {
    let turns: Turn[] = [];
    turns = upsertTurn(turns, { speaker: 'dana', text: 'hel', final: false, at: 1 });
    turns = upsertTurn(turns, { speaker: 'dana', text: 'hello', final: false, at: 2 });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.text).toBe('hello');
    turns = upsertTurn(turns, { speaker: 'dana', text: 'hello there', final: true, at: 3 });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.final).toBe(true);
    // next live turn starts a new row
    turns = upsertTurn(turns, { speaker: 'dana', text: 'and', final: false, at: 4 });
    expect(turns).toHaveLength(2);
  });
  it('keeps a typed turn distinct and final', () => {
    let turns: Turn[] = [];
    turns = upsertTurn(turns, { speaker: 'me', text: 'link?', final: true, typed: true, at: 1 });
    expect(turns[0]?.typed).toBe(true);
  });
});
