// Stable id for a 1:1 conversation between two userIds (order-independent), so
// re-opening a DM finds the existing room rather than creating a duplicate.
export function directConversationId(a: string, b: string): string {
  return `dm-${[a, b].sort().join('+')}`;
}
