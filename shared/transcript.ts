/**
 * Live call transcript model.
 *
 * A transcript is an ordered list of turns. Realtime STT streams partial
 * (non-final) text for a speaker; each partial REPLACES the speaker's still-live
 * row until `final` flips true, at which point the row freezes and the next
 * partial starts a fresh row. Typed messages append as final turns flagged
 * `typed`, and are never replaced by a subsequent partial.
 */
export interface Turn {
  speaker: string;
  text: string;
  final: boolean;
  typed?: boolean;
  at: number;
}

// If the last turn for this speaker is still live (non-final, not typed),
// replace it; otherwise append a new turn.
export function upsertTurn(turns: Turn[], next: Turn): Turn[] {
  const last = turns[turns.length - 1];
  if (last?.speaker === next.speaker && !last.final && !last.typed) {
    const copy = turns.slice(0, -1);
    return [...copy, { ...next }];
  }
  // A completed turn arriving again as a duplicate is a no-op, not a new row.
  // The bot's TTS fires its subtitle callback once more at completion, so a
  // second final turn with identical text used to append and every bot reply
  // showed TWICE. Only same-speaker + already-final + same text is suppressed,
  // so a genuine repeated line ("yes. yes.") across two turns is untouched.
  if (last?.speaker === next.speaker && last.final && next.final && last.text === next.text) {
    return turns;
  }
  return [...turns, { ...next }];
}

// Speech-to-text models emit a stock phrase on effectively-silent audio —
// Whisper's notorious "Thank you." / "Thanks for watching." — so a caller who
// never spoke got a transcript putting words in their mouth. A FINAL STT turn
// whose entire text is one of these (nothing else said) is dropped. Kept
// deliberately narrow: it only matches a turn that is EXACTLY the phrase, so a
// real "thank you, everyone" is never touched.
const SILENCE_HALLUCINATIONS = new Set([
  'thank you',
  'thank you.',
  'thanks for watching',
  'thanks for watching.',
  'thanks for watching!',
  'you',
  '.',
  'bye',
  'bye.',
]);

export function isSilenceHallucination(text: string): boolean {
  return SILENCE_HALLUCINATIONS.has(text.trim().toLowerCase());
}
