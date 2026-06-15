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
  if (last && last.speaker === next.speaker && !last.final && !last.typed) {
    const copy = turns.slice(0, -1);
    return [...copy, { ...next }];
  }
  return [...turns, { ...next }];
}
