import { describe, it, expect } from 'vitest';
import { isSilenceHallucination, upsertTurn, type Turn } from '../../shared/transcript';

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

  it('does not append a duplicate final turn (the bot double-print)', () => {
    // The bot's TTS fires its subtitle callback once more at completion, so the
    // same final turn arrives twice — it used to render the reply twice.
    let turns: Turn[] = [];
    turns = upsertTurn(turns, { speaker: 'bot-ugly', text: 'cute.', final: false, at: 1 });
    turns = upsertTurn(turns, { speaker: 'bot-ugly', text: 'cute.', final: true, at: 2 });
    turns = upsertTurn(turns, { speaker: 'bot-ugly', text: 'cute.', final: true, at: 3 });
    expect(turns).toHaveLength(1);
  });

  it('still allows a genuinely repeated line as a separate turn', () => {
    // Two distinct turns that happen to say the same thing must both survive —
    // the dedup is only for the immediate duplicate of a just-finalized turn.
    let turns: Turn[] = [];
    turns = upsertTurn(turns, { speaker: 'me', text: 'yes', final: true, at: 1 });
    turns = upsertTurn(turns, { speaker: 'you', text: 'ok', final: true, at: 2 });
    turns = upsertTurn(turns, { speaker: 'me', text: 'yes', final: true, at: 3 });
    expect(turns).toHaveLength(3);
  });
});

describe('isSilenceHallucination', () => {
  // Whisper emits a stock phrase on silence; a caller who never spoke got a
  // transcript putting "Thank you." in their mouth.
  it('flags the stock silence phrases regardless of case/space', () => {
    for (const t of ['Thank you.', 'thank you', ' THANK YOU ', 'Thanks for watching', 'you', '.']) {
      expect(isSilenceHallucination(t)).toBe(true);
    }
  });

  it('leaves real speech alone, even when it contains the phrase', () => {
    for (const t of ['thank you for the agenda', 'ok thanks', 'I said thank you to her', 'you were right']) {
      expect(isSilenceHallucination(t)).toBe(false);
    }
  });
});
