/**
 * Single-select toggle rule for the chat thread. Tapping the already-selected
 * message clears it; tapping any other message selects (or moves to) it.
 */
export function nextSelectedId(current: string | null, tappedId: string): string | null {
  return current === tappedId ? null : tappedId;
}
